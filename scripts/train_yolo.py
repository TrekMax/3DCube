"""Train a cube locator or six sticker colors and export a browser-ready ONNX model."""
import argparse
from pathlib import Path
from export_yolo import TASK_NAMES, export_model, validate_class_names


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
    import yaml

    config = yaml.safe_load(Path(dataset).read_text())
    try:
        validate_class_names(config.get("names") if isinstance(config, dict) else None, args.task)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    if args.imgsz < 32 or args.imgsz % 32:
        raise SystemExit("--imgsz must be a positive multiple of 32")

    from ultralytics import YOLO

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
