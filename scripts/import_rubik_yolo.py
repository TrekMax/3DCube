"""Export rubik-yolo's trained best.pt into the two detection formats used by Cube Guide.

The source predicts rotated sticker/face rectangles. The adapters expose their enclosing
axis-aligned rectangles, retain only the winning class, and reorder sticker classes to URFDLB.
Keep one cube face upright and nearly frontal when scanning; this does not rectify perspective.
"""
import argparse
import ast
import copy
import hashlib
import json
from pathlib import Path
import shutil

SOURCE_NAMES = ["blue", "green", "orange", "red", "white", "yellow", "cube face", "side_face"]
STICKER_IDS = [4, 3, 1, 5, 2, 0]  # white, red, green, yellow, orange, blue -> URFDLB
OUTPUT_NAMES = {
    "stickers": ["white", "red", "green", "yellow", "orange", "blue"],
    "locator": ["cube face"],
}


def validate_source_names(names):
    if isinstance(names, dict):
        if any(type(i) is not int for i in names) or set(names) != set(range(8)):
            raise ValueError("rubik-yolo requires class IDs 0–7.")
        names = [names[i] for i in range(8)]
    if not isinstance(names, list) or any(not isinstance(name, str) for name in names):
        raise ValueError("Missing rubik-yolo class names.")
    if [name.strip().lower() for name in names] != SOURCE_NAMES:
        raise ValueError(f"Expected rubik-yolo classes {SOURCE_NAMES}; use the trained best.pt, not the DOTA base weights.")


def adapt_obb_model(source, purpose):
    """Append ONNX operations, leaving learned weights and the original graph unchanged."""
    import numpy as np
    import onnx
    from onnx import helper, numpy_helper, TensorProto

    if purpose not in OUTPUT_NAMES:
        raise ValueError("purpose must be stickers or locator")
    metadata = {item.key: item.value for item in source.metadata_props}
    if metadata.get("task") != "obb":
        raise ValueError("Expected an Ultralytics OBB model.")
    validate_source_names(ast.literal_eval(metadata.get("names", "None")))
    if len(source.graph.input) != 1 or len(source.graph.output) != 1:
        raise ValueError("Expected a single image input and raw detection output.")
    shape = [d.dim_value for d in source.graph.output[0].type.tensor_type.shape.dim]
    input_shape = [d.dim_value for d in source.graph.input[0].type.tensor_type.shape.dim]
    if len(shape) != 3 or shape[:2] != [1, 13] or shape[2] <= 0:
        raise ValueError(f"Expected static raw OBB output [1,13,N], received {shape}. Export with nms=False.")
    if (len(input_shape) != 4 or input_shape[:2] != [1, 3]
            or input_shape[2] <= 0 or input_shape[2] != input_shape[3]
            or source.graph.input[0].type.tensor_type.elem_type != TensorProto.FLOAT):
        raise ValueError("Export static float32 input [1,3,S,S], batch=1, dynamic=False.")
    model = copy.deepcopy(source)
    graph = model.graph
    # The browser runtime does not expose ONNX custom metadata. This reserved input name
    # carries the preprocessing contract even if the user renames the .onnx file.
    original_input = graph.input[0].name
    graph.input[0].name = "cube_guide_full_frame"
    for operation in graph.node:
        for index, name in enumerate(operation.input):
            if name == original_input:
                operation.input[index] = graph.input[0].name
    prediction = graph.output[0].name
    prefix = "cube_guide/"
    if any(t.name.startswith(prefix) for t in graph.initializer):
        raise ValueError("This graph already contains a Cube Guide adapter.")

    def constant(name, values):
        key = prefix + name
        graph.initializer.append(numpy_helper.from_array(np.asarray(values, dtype=np.int64), key))
        return key

    def node(op, inputs, name, **attributes):
        key = prefix + name
        graph.node.append(helper.make_node(op, inputs, [key], name=key, **attributes))
        return key

    def channels(indices, name):
        return node("Gather", [prediction, constant(name + "_indices", indices)], name, axis=1)

    xy = channels([0, 1], "xy")
    width, height = channels([2], "width"), channels([3], "height")
    angle = channels([12], "angle")
    cos = node("Abs", [node("Cos", [angle], "cos")], "abs_cos")
    sin = node("Abs", [node("Sin", [angle], "sin")], "abs_sin")
    aabb_width = node("Add", [node("Mul", [width, cos], "width_cos"),
                              node("Mul", [height, sin], "height_sin")], "aabb_width")
    aabb_height = node("Add", [node("Mul", [width, sin], "width_sin"),
                               node("Mul", [height, cos], "height_cos")], "aabb_height")
    all_scores = channels(list(range(4, 12)), "all_scores")
    winner = node("ArgMax", [all_scores], "winner", axis=1, keepdims=1)
    ids = STICKER_IDS if purpose == "stickers" else [6]
    scores = channels([i + 4 for i in ids], "selected_scores")
    matches = node("Equal", [winner, constant("selected_ids", np.array(ids).reshape(1, -1, 1))], "matches")
    mask = node("Cast", [matches], "mask", to=TensorProto.FLOAT)
    scores = node("Mul", [scores, mask], "scores")
    output = node("Concat", [xy, aabb_width, aabb_height, scores], "detections", axis=1)
    del graph.output[:]
    graph.output.append(helper.make_tensor_value_info(output, TensorProto.FLOAT, [1, 4 + len(ids), shape[2]]))
    metadata.update({
        "task": "detect",
        "names": str(dict(enumerate(OUTPUT_NAMES[purpose]))),
        "cube_guide_source_names": str(dict(enumerate(SOURCE_NAMES))),
        "cube_guide_adapter": f"rubik-yolo-obb-to-{purpose}-v1",
        "cube_guide_input_scope": "frame",
        "description": "Rotated rectangles converted to enclosing AABBs; upright, frontal single-face capture required.",
    })
    helper.set_model_props(model, metadata)
    onnx.checker.check_model(model)
    return model


def adapted_reference(raw, purpose):
    """Independent NumPy reference for export verification."""
    import numpy as np
    ids = STICKER_IDS if purpose == "stickers" else [6]
    output = np.zeros((1, 4 + len(ids), raw.shape[2]), dtype=np.float32)
    output[:, :2] = raw[:, :2]
    width, height, angle = raw[:, 2], raw[:, 3], raw[:, 12]
    output[:, 2] = abs(np.cos(angle)) * width + abs(np.sin(angle)) * height
    output[:, 3] = abs(np.sin(angle)) * width + abs(np.cos(angle)) * height
    winner = raw[:, 4:12].argmax(axis=1)
    for index, source_id in enumerate(ids):
        output[:, index + 4] = np.where(winner == source_id, raw[:, source_id + 4], 0)
    return output


def export_models(weights, output_dir, size):
    import numpy as np
    import onnx
    import onnxruntime as ort

    output_dir.mkdir(parents=True, exist_ok=True)
    source_hash = hashlib.sha256(weights.read_bytes()).hexdigest()
    if weights.suffix.lower() == ".pt":
        from ultralytics import YOLO
        # Ultralytics writes beside the weight file. Work on a copy to preserve the source repo.
        local_weights = output_dir / "rubik-yolo-obb.pt"
        if weights.resolve() != local_weights.resolve():
            shutil.copy2(weights, local_weights)
        model = YOLO(str(local_weights))
        if model.task != "obb":
            raise ValueError("Expected the trained YOLOv8 OBB best.pt.")
        validate_source_names(model.names)
        raw_path = Path(model.export(format="onnx", imgsz=size, batch=1, dynamic=False,
                                    simplify=False, opset=17, half=False, nms=False, device="cpu"))
    elif weights.suffix.lower() == ".onnx":
        raw_path = weights
    else:
        raise ValueError("Input must be best.pt or its static raw OBB ONNX export.")
    source = onnx.load(str(raw_path))
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    source_session = ort.InferenceSession(str(raw_path), options, providers=["CPUExecutionProvider"])
    input_shape = source_session.get_inputs()[0].shape
    # Adaptation validates the shape first, before allocating the verification image.
    converted = {purpose: adapt_obb_model(source, purpose) for purpose in OUTPUT_NAMES}
    probe = np.random.default_rng(42).random(input_shape, dtype=np.float32)
    raw = source_session.run(None, {source_session.get_inputs()[0].name: probe})[0]
    manifest = {
        "source_file": weights.name,
        "source_sha256": source_hash,
        "source_classes": SOURCE_NAMES,
        "input_shape": input_shape,
        "raw_output_shape": list(raw.shape),
        "class_faces": list("URFDLB"),
        "input_scope": "frame",
        "limitation": "Six standard colors only; one Blue class. Face boxes are enclosing AABBs, not perspective-rectified faces.",
        "models": {},
    }
    for purpose, graph in converted.items():
        output = output_dir / f"rubik-yolo-{purpose}.onnx"
        onnx.save(graph, str(output))
        session = ort.InferenceSession(str(output), options, providers=["CPUExecutionProvider"])
        actual = session.run(None, {session.get_inputs()[0].name: probe})[0]
        np.testing.assert_allclose(actual, adapted_reference(raw, purpose), rtol=1e-4, atol=1e-3)
        manifest["models"][purpose] = {
            "file": output.name, "classes": OUTPUT_NAMES[purpose], "output_shape": list(actual.shape),
            "input_name": session.get_inputs()[0].name,
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        }
        print(f"{purpose}: {output.resolve()} | {actual.shape}")
    (output_dir / "rubik-yolo.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("weights", type=Path, help="Path to rubik-yolo/best.pt (not yolov8n-obb.pt)")
    parser.add_argument("--output-dir", type=Path, default=Path("models"))
    parser.add_argument("--imgsz", type=int, default=640)
    args = parser.parse_args()
    if args.imgsz < 32 or args.imgsz % 32:
        parser.error("--imgsz must be a positive multiple of 32")
    export_models(args.weights, args.output_dir, args.imgsz)


if __name__ == "__main__":
    main()
