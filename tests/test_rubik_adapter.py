"""Run with the ML virtual environment; uses synthetic ONNX graphs, no trained weights."""
import importlib.util
import math
import unittest

from scripts.import_rubik_yolo import SOURCE_NAMES, adapt_obb_model, validate_source_names


class RubikClassTests(unittest.TestCase):
    def test_trained_classes_and_base_weight_rejection(self):
        validate_source_names(dict(enumerate(name.title() for name in SOURCE_NAMES)))
        for names in (["plane"] * 15, SOURCE_NAMES[::-1], {str(i): n for i, n in enumerate(SOURCE_NAMES)}):
            with self.subTest(names=names), self.assertRaises(ValueError):
                validate_source_names(names)


@unittest.skipUnless(importlib.util.find_spec("onnxruntime") and importlib.util.find_spec("onnx"),
                     "Install the ONNX test dependencies in .venv")
class RubikAdapterTests(unittest.TestCase):
    def setUp(self):
        import numpy as np
        import onnx
        self.np = np
        self.onnx = onnx
        self.raw = np.zeros((1, 13, 8), dtype=np.float32)
        self.raw[:, :4] = np.array([16, 16, 20, 10]).reshape(1, 4, 1)
        self.raw[:, 12] = [0, math.pi / 2, math.pi / 4, -math.pi / 4, 0, 0, 0, 0]
        for i in range(8):
            self.raw[0, 4 + i, i] = .9
        # Strong sticker scores on face/side predictions must not leak into sticker output.
        self.raw[0, 4, 6:8] = .8
        helper = onnx.helper
        self.model = helper.make_model(helper.make_graph(
            [helper.make_node("Constant", [], ["output0"], value=onnx.numpy_helper.from_array(self.raw))],
            "fixture",
            [helper.make_tensor_value_info("images", onnx.TensorProto.FLOAT, [1, 3, 32, 32])],
            [helper.make_tensor_value_info("output0", onnx.TensorProto.FLOAT, [1, 13, 8])],
        ), opset_imports=[helper.make_opsetid("", 17)], ir_version=9)
        helper.set_model_props(self.model, {"task": "obb", "names": str(dict(enumerate(SOURCE_NAMES)))})

    def infer(self, purpose):
        import onnxruntime as ort
        converted = adapt_obb_model(self.model, purpose)
        session = ort.InferenceSession(converted.SerializeToString(), providers=["CPUExecutionProvider"])
        self.assertEqual(session.get_inputs()[0].name, "cube_guide_full_frame")
        return session.run(None, {session.get_inputs()[0].name: self.np.zeros((1, 3, 32, 32), dtype=self.np.float32)})[0]

    def test_rectangles_enclose_rotated_corners(self):
        result = self.infer("stickers")
        for index in range(4):
            angle = float(self.raw[0, 12, index])
            corners = [(x * math.cos(angle) - y * math.sin(angle),
                        x * math.sin(angle) + y * math.cos(angle))
                       for x in [-10, 10] for y in [-5, 5]]
            self.assertAlmostEqual(float(result[0, 2, index]), max(x for x, y in corners) - min(x for x, y in corners), places=4)
            self.assertAlmostEqual(float(result[0, 3, index]), max(y for x, y in corners) - min(y for x, y in corners), places=4)

    def test_stickers_are_urfdlb_and_exclude_both_face_classes(self):
        result = self.infer("stickers")
        self.assertEqual(result.shape, (1, 10, 8))
        self.assertEqual(result[0, 4:, :6].argmax(axis=0).tolist(), [5, 2, 4, 1, 0, 3])
        self.assertTrue((result[0, 4:, 6:] == 0).all())

    def test_locator_retains_only_cube_face(self):
        result = self.infer("locator")
        self.assertEqual(result.shape, (1, 5, 8))
        self.assertEqual(self.np.flatnonzero(result[0, 4]).tolist(), [6])

    def test_conversion_preserves_source_graph(self):
        original = self.model.SerializeToString()
        converted = adapt_obb_model(self.model, "stickers")
        self.assertEqual(self.model.SerializeToString(), original)
        self.assertEqual({p.key: p.value for p in converted.metadata_props}["task"], "detect")

    def test_rejects_dynamic_and_wrong_task_exports(self):
        self.model.graph.input[0].type.tensor_type.shape.dim[2].dim_param = "height"
        with self.assertRaisesRegex(ValueError, "static"):
            adapt_obb_model(self.model, "locator")
        self.onnx.helper.set_model_props(self.model, {"task": "detect"})
        with self.assertRaisesRegex(ValueError, "OBB"):
            adapt_obb_model(self.model, "locator")


if __name__ == "__main__":
    unittest.main()
