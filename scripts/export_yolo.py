"""Export trained Ultralytics YOLOv8 / YOLO11 detection weights for this web app."""
import argparse
from pathlib import Path
import shutil

TASK_NAMES = {"cube": ["cube"], "stickers": ["white", "red", "green", "yellow", "orange", "blue"]}


def validate_class_names(names, task: str) -> list[str]:
    """Validate class IDs without requiring Ultralytics or downloading weights."""
    if task not in TASK_NAMES:
        raise ValueError(f"Unknown detection task: {task}")
    count = len(TASK_NAMES[task])
    if isinstance(names, dict):
        if any(type(key) is not int for key in names) or set(names) != set(range(count)):
            raise ValueError(f"Expected contiguous integer class IDs 0–{count - 1}.")
        ordered = [names[i] for i in range(count)]
    elif isinstance(names, list) and len(names) == count:
        ordered = list(names)
    else:
        raise ValueError(f"Expected {count} class names for {task}.")
    if any(not isinstance(name, str) or not name.strip() for name in ordered):
        raise ValueError("Every class must have a non-empty name.")
    if len({name.strip() for name in ordered}) != count:
        raise ValueError("Class names must be distinct.")
    if task == "cube" and ordered != ["cube"]:
        raise ValueError("The locator requires a single class named cube.")
    return ordered


def export_model(weights: Path, output: Path, size: int, task: str = "stickers"):
    from ultralytics import YOLO

    model = YOLO(str(weights))
    if model.task != "detect":
        raise ValueError("A detection model is required (not segmentation or classification).")
    class_names = validate_class_names(model.names, task)
    exported = Path(model.export(
        format="onnx", imgsz=size, batch=1, dynamic=False,
        simplify=False, opset=17, half=False, nms=False, device="cpu",
    ))
    # Check the real output contract with ONNX Runtime, not just the filename.
    import numpy as np
    import onnxruntime as ort
    session = ort.InferenceSession(str(exported), providers=["CPUExecutionProvider"])
    result = session.run(None, {session.get_inputs()[0].name: np.zeros((1, 3, size, size), dtype=np.float32)})[0]
    channels = len(class_names) + 4
    if result.ndim != 3 or result.shape[0] != 1 or not (result.shape[1] == channels or result.shape[2] in (channels, 6)):
        raise ValueError(f"Unsupported output shape: {result.shape}")
    output.parent.mkdir(parents=True, exist_ok=True)
    if exported.resolve() != output.resolve():
        shutil.copy2(exported, output)
    print(f"Browser model: {output.resolve()} | output: {result.shape}")
    print("Class IDs: " + ", ".join(f"{i}={name}" for i, name in enumerate(class_names)))
    if task == "stickers":
        print("Match these IDs to the six faces in 自定义配色 → YOLO 类别映射 before scanning.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("weights", type=Path)
    parser.add_argument("--task", choices=TASK_NAMES, default="stickers")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--imgsz", type=int, default=320)
    args = parser.parse_args()
    if args.imgsz < 32 or args.imgsz % 32:
        parser.error("--imgsz must be a positive multiple of 32")
    output = args.output or Path("models/cube-locator.onnx" if args.task == "cube" else "models/cube-stickers.onnx")
    export_model(args.weights, output, args.imgsz, args.task)


if __name__ == "__main__":
    main()
