import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class RouteDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.routes = json.loads((ROOT / "data/locations.json").read_text(encoding="utf-8"))

    def test_json_and_route_ids(self):
        self.assertEqual(len(self.routes), 37)
        ids = [route["id"] for route in self.routes]
        self.assertEqual(len(ids), len(set(ids)))

    def test_required_shape_and_gps_ranges(self):
        for route in self.routes:
            with self.subTest(route=route["id"]):
                for key in ("id", "name", "difficulty", "country", "range", "entry", "summit", "links"):
                    self.assertIn(key, route)
                for key in ("entry", "summit"):
                    point = route[key]
                    lat, lon = point.get("latitude"), point.get("longitude")
                    self.assertEqual(lat is None, lon is None, f"{route['id']} {key}: partial coordinate")
                    if lat is not None:
                        self.assertTrue(-90 <= lat <= 90)
                        self.assertTrue(-180 <= lon <= 180)

    def test_newly_supplied_points_and_elevations_are_preserved(self):
        by_id = {route["id"]: route for route in self.routes}
        self.assertEqual((by_id["wilde-gams"]["entry"]["latitude"], by_id["wilde-gams"]["entry"]["longitude"], by_id["wilde-gams"]["entry"]["elevation"]), (47.515694, 12.758389, 670))
        self.assertEqual((by_id["isidor-klettersteig-gruenstein"]["entry"]["latitude"], by_id["isidor-klettersteig-gruenstein"]["entry"]["longitude"], by_id["isidor-klettersteig-gruenstein"]["entry"]["elevation"]), (47.591057, 12.987299, 860))
        self.assertEqual((by_id["postalmklamm-klettersteig"]["summit"]["latitude"], by_id["postalmklamm-klettersteig"]["summit"]["longitude"]), (47.6689, 13.4625))
        self.assertEqual((by_id["city-wall-klettersteig"]["summit"]["latitude"], by_id["city-wall-klettersteig"]["summit"]["longitude"]), (47.8049, 13.0506))


if __name__ == "__main__":
    unittest.main()
