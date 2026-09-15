"""Export trained Ultralytics YOLOv8 / YOLO11 detection weights for this web app."""
import argparse
from pathlib import Path
import shutil

EXPECTED_NAMES = ["white", "red", "green", "yellow", "orange", "blue"]


def export_model(weights: Path, output: Path, size: int):
    from ultralytics import YOLO

    model = YOLO(str(weights))
    if model.task != "detect":
        raise ValueError("A detection model is required (not segmentation or classification).")
    if [model.names[i] for i in range(len(model.names))] != EXPECTED_NAMES:
        raise ValueError(f"Train these six classes in order: {EXPECTED_NAMES}")
    exported = Path(model.export(
        format="onnx", imgsz=size, batch=1, dynamic=False,
        simplify=False, opset=17, half=False, nms=False, device="cpu",
    ))
    # Check the real output contract with ONNX Runtime, not just the filename.
    import numpy as np
    import onnxruntime as ort
    session = ort.InferenceSession(str(exported), providers=["CPUExecutionProvider"])
    result = session.run(None, {session.get_inputs()[0].name: np.zeros((1, 3, size, size), dtype=np.float32)})[0]
    if result.ndim != 3 or result.shape[0] != 1 or not (result.shape[1] == 10 or result.shape[2] in (10, 6)):
        raise ValueError(f"Unsupported output shape: {result.shape}")
    output.parent.mkdir(parents=True, exist_ok=True)
    if exported.resolve() != output.resolve():
        shutil.copy2(exported, output)
    print(f"Browser model: {output.resolve()} | output: {result.shape}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("weights", type=Path)
    parser.add_argument("--output", type=Path, default=Path("models/cube-stickers.onnx"))
    parser.add_argument("--imgsz", type=int, default=320)
    args = parser.parse_args()
    if args.imgsz < 32 or args.imgsz % 32:
        parser.error("--imgsz must be a positive multiple of 32")
    export_model(args.weights, args.output, args.imgsz)


if __name__ == "__main__":
    main()
