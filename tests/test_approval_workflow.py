import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("apply_approved_changes", ROOT / "scripts/apply_approved_changes.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ApprovalWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = pathlib.Path(self.temp.name)
        MODULE.ROOT = base
        MODULE.LOCATIONS = base / "data/locations.json"
        MODULE.APPROVALS = base / "data/approved-changes.json"
        MODULE.HISTORY = base / "data/research-history.json"
        MODULE.REPORT = base / "reports/approved-changes.md"
        MODULE.LOCATIONS.parent.mkdir(parents=True)
        MODULE.LOCATIONS.write_text(json.dumps([{"id":"route-1","name":"Test","entry":{"latitude":None,"longitude":13.0,"elevation":500},"summit":{}}]),encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_valid_reviewed_coordinate_is_applied_and_historized(self):
        MODULE.APPROVALS.write_text(json.dumps({"changes":[{"routeId":"route-1","path":"entry.latitude","expectedValue":None,"value":47.5,"source":"https://example.org/tour","confidence":0.95,"verificationStatus":"source-confirmed"}]}),encoding="utf-8")
        MODULE.main()
        route=json.loads(MODULE.LOCATIONS.read_text(encoding="utf-8"))[0]
        self.assertEqual(route["entry"]["latitude"],47.5)
        self.assertEqual(route["entry"]["longitude"],13.0)
        self.assertTrue(route["entry"]["verified"])
        self.assertEqual(len(json.loads(MODULE.HISTORY.read_text(encoding="utf-8"))["entries"]),1)

    def test_stale_expected_value_blocks_overwrite(self):
        MODULE.APPROVALS.write_text(json.dumps({"changes":[{"routeId":"route-1","path":"entry.elevation","expectedValue":450,"value":600,"source":"https://example.org/tour","confidence":0.95,"verificationStatus":"verified"}]}),encoding="utf-8")
        with self.assertRaisesRegex(ValueError,"current value changed"):
            MODULE.main()
        route=json.loads(MODULE.LOCATIONS.read_text(encoding="utf-8"))[0]
        self.assertEqual(route["entry"]["elevation"],500)

    def test_unapproved_field_is_rejected(self):
        MODULE.APPROVALS.write_text(json.dumps({"changes":[{"routeId":"route-1","path":"id","expectedValue":"route-1","value":"changed","source":"https://example.org/tour","confidence":1,"verificationStatus":"verified"}]}),encoding="utf-8")
        with self.assertRaisesRegex(ValueError,"field is not allowed"):
            MODULE.main()


if __name__ == "__main__":
    unittest.main()
