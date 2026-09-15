"""Train six sticker colors using Ultralytics, then export a browser-ready ONNX model."""
import argparse
from pathlib import Path

EXPECTED_NAMES = ["white", "red", "green", "yellow", "orange", "blue"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", default="models/cube-stickers.yaml")
    parser.add_argument("--model", default="yolo11n.pt")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=320)
    parser.add_argument("--device", default="cpu", help="cpu, 0, or another Ultralytics device")
    args = parser.parse_args()
    import yaml
    from ultralytics import YOLO
    from export_yolo import export_model

    config = yaml.safe_load(Path(args.data).read_text())
    names = config.get("names")
    ordered = [names.get(i) for i in range(len(names))] if isinstance(names, dict) else names
    if ordered != EXPECTED_NAMES:
        raise SystemExit(f"Expected class IDs in this order: {EXPECTED_NAMES}")
    if args.imgsz < 32 or args.imgsz % 32:
        raise SystemExit("--imgsz must be a positive multiple of 32")

    model = YOLO(args.model)
    model.train(
        data=args.data, epochs=args.epochs, imgsz=args.imgsz, device=args.device,
        project="runs/cube", name="stickers", seed=42,
        # Color determines the class. Hue augmentation would invalidate labels.
        hsv_h=0.0, hsv_s=0.15, hsv_v=0.25,
        degrees=12.0, perspective=0.0002, fliplr=0.5,
    )
    best = Path(model.trainer.best)
    export_model(best, Path("models/cube-stickers.onnx"), args.imgsz)


if __name__ == "__main__":
    main()
