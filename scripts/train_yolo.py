"""Train a cube locator or six sticker colors and export a browser-ready ONNX model."""
import argparse
from pathlib import Path

TASK_NAMES = {"cube": ["cube"], "stickers": ["white", "red", "green", "yellow", "orange", "blue"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", choices=TASK_NAMES, default="stickers")
    parser.add_argument("--data", help="Dataset YAML; defaults to the selected task's configuration")
    parser.add_argument("--model", default="yolo11n.pt")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=320)
    parser.add_argument("--device", default="cpu", help="cpu, 0, or another Ultralytics device")
    args = parser.parse_args()
    dataset = args.data or ("models/cube-locator.yaml" if args.task == "cube" else "models/cube-stickers.yaml")
    expected_names = TASK_NAMES[args.task]
    import yaml
    from ultralytics import YOLO
    from export_yolo import export_model

    config = yaml.safe_load(Path(dataset).read_text())
    names = config.get("names")
    ordered = [names.get(i) for i in range(len(names))] if isinstance(names, dict) else names
    if ordered != expected_names:
        raise SystemExit(f"Expected class IDs in this order: {expected_names}")
    if args.imgsz < 32 or args.imgsz % 32:
        raise SystemExit("--imgsz must be a positive multiple of 32")

    model = YOLO(args.model)
    model.train(
        data=dataset, epochs=args.epochs, imgsz=args.imgsz, device=args.device,
        project="runs/cube", name=args.task, seed=42,
        # Color determines the class. Hue augmentation would invalidate labels.
        hsv_h=0.0, hsv_s=0.15, hsv_v=0.25,
        degrees=12.0, perspective=0.0002, fliplr=0.5,
    )
    best = Path(model.trainer.best)
    output = "models/cube-locator.onnx" if args.task == "cube" else "models/cube-stickers.onnx"
    export_model(best, Path(output), args.imgsz, args.task)


if __name__ == "__main__":
    main()
