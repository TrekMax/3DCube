"""TEST ONLY: follow the same brightness-driven face as generate_locator.py.

Reading a crop instead of the full frame changes both preprocessing and coordinates,
so this graph exercises the full-frame contract without any trained weights.
"""
from pathlib import Path
import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto

base = np.zeros((1, 10, 9), dtype=np.float32)
x_mask = np.zeros_like(base)
score_mask = np.zeros_like(base)
for i in range(9):
    base[0, 0, i] = ((i % 3) - 1) * 80 / 3
    base[0, 1, i] = 160 + ((i // 3) - 1) * 80 / 3
    base[0, 2:4, i] = 20
    x_mask[0, 0, i] = 1
    score_mask[0, 4, i] = 1
constants = {"base": base, "x_mask": x_mask, "score_mask": score_mask,
             "scale": np.array(220, dtype=np.float32),
             "offset": np.array(20, dtype=np.float32),
             "threshold": np.array(.3, dtype=np.float32)}
nodes = [
    helper.make_node("ReduceMean", ["cube_guide_full_frame"], ["mean"], axes=[0, 1, 2, 3], keepdims=0),
    helper.make_node("Mul", ["mean", "scale"], ["scaled"]),
    helper.make_node("Add", ["scaled", "offset"], ["x"]),
    helper.make_node("Greater", ["mean", "threshold"], ["visible"]),
    helper.make_node("Cast", ["visible"], ["score"], to=TensorProto.FLOAT),
    helper.make_node("Mul", ["x", "x_mask"], ["positions"]),
    helper.make_node("Mul", ["score", "score_mask"], ["scores"]),
    helper.make_node("Add", ["base", "positions"], ["geometry"]),
    helper.make_node("Add", ["geometry", "scores"], ["output0"]),
]
graph = helper.make_graph(nodes, "TEST_ONLY_full_frame_stickers",
    [helper.make_tensor_value_info("cube_guide_full_frame", TensorProto.FLOAT, [1, 3, 320, 320])],
    [helper.make_tensor_value_info("output0", TensorProto.FLOAT, [1, 10, 9])],
    initializer=[numpy_helper.from_array(value, name) for name, value in constants.items()])
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], ir_version=9)
onnx.checker.check_model(model)
onnx.save(model, Path(__file__).with_name("input-driven-frame-stickers-test.onnx"))
