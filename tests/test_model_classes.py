"""Class validation tests; no ML dependencies or model downloads required."""
import unittest

from scripts.export_yolo import TASK_NAMES, validate_class_names


class ModelClassTests(unittest.TestCase):
    def test_default_colors(self):
        self.assertEqual(validate_class_names(TASK_NAMES["stickers"], "stickers"),
                         TASK_NAMES["stickers"])

    def test_custom_colors_and_order(self):
        names = {5: "blue", 2: "green", 0: "purple", 4: "orange", 1: "red", 3: "pink"}
        self.assertEqual(validate_class_names(names, "stickers"),
                         ["purple", "red", "green", "pink", "orange", "blue"])

    def test_class_count(self):
        for names in (None, "purple", [], ["purple"], list("abcdefg")):
            with self.subTest(names=names), self.assertRaises(ValueError):
                validate_class_names(names, "stickers")

    def test_ids_must_be_contiguous_integers(self):
        for ids in ([0, 1, 2, 3, 4, 6], list("012345"), [False, 1, 2, 3, 4, 5]):
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                validate_class_names(dict(zip(ids, "abcdef")), "stickers")

    def test_names_must_be_nonempty_unique_strings(self):
        for name in (None, 3, "", "  ", "b", " b "):
            with self.subTest(name=name), self.assertRaises(ValueError):
                validate_class_names([name, "b", "c", "d", "e", "f"], "stickers")

    def test_locator_keeps_single_cube_class(self):
        self.assertEqual(validate_class_names({0: "cube"}, "cube"), ["cube"])
        for names in (["purple"], TASK_NAMES["stickers"]):
            with self.subTest(names=names), self.assertRaises(ValueError):
                validate_class_names(names, "cube")

    def test_unknown_task(self):
        with self.assertRaises(ValueError):
            validate_class_names(["cube"], "pose")


if __name__ == "__main__":
    unittest.main()
