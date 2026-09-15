"""Generate a TEST-ONLY input-driven ONNX graph; this is not a trained detector.

Mean image brightness controls x-position and confidence so browser tests can
exercise frame mapping, motion and target loss using a deterministic camera.
"""
from pathlib import Path
import onnx
from onnx import helper, TensorProto

def constant(name, dtype, shape, data):
    return helper.make_node("Constant", [], [name], value=helper.make_tensor(name, dtype, shape, data))

nodes = [
    helper.make_node("ReduceMean", ["images"], ["mean"], axes=[0, 1, 2, 3], keepdims=0),
    constant("scale", TensorProto.FLOAT, [], [220]),
    constant("offset", TensorProto.FLOAT, [], [20]),
    constant("threshold", TensorProto.FLOAT, [], [.3]),
    constant("axes", TensorProto.INT64, [1], [0]),
    constant("shape", TensorProto.INT64, [3], [1, 5, 1]),
    constant("geometry", TensorProto.FLOAT, [3], [160, 80, 80]),
    helper.make_node("Mul", ["mean", "scale"], ["scaled"]),
    helper.make_node("Add", ["scaled", "offset"], ["x"]),
    helper.make_node("Greater", ["mean", "threshold"], ["visible"]),
    helper.make_node("Cast", ["visible"], ["score"], to=TensorProto.FLOAT),
    helper.make_node("Unsqueeze", ["x", "axes"], ["x1"]),
    helper.make_node("Unsqueeze", ["score", "axes"], ["score1"]),
    helper.make_node("Concat", ["x1", "geometry", "score1"], ["flat"], axis=0),
    helper.make_node("Reshape", ["flat", "shape"], ["output0"]),
]
graph = helper.make_graph(nodes, "TEST_ONLY_brightness_controls_position",
    [helper.make_tensor_value_info("images", TensorProto.FLOAT, [1, 3, 320, 320])],
    [helper.make_tensor_value_info("output0", TensorProto.FLOAT, [1, 5, 1])])
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
model.ir_version = 9
onnx.checker.check_model(model)
onnx.save(model, Path(__file__).with_name("input-driven-cube-test.onnx"))
