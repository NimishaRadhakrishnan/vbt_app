from app.application.services.geofence_service import (
    Fence,
    haversine_m,
    is_outside_all,
    nearest_fence,
)
import uuid

CBE = (11.0168, 76.9558)


def fence(lat, lng, r, name="Coimbatore"):
    return Fence(uuid.uuid4(), name, lat, lng, r)


def test_haversine_known_distance():
    # 0.01 degrees of latitude is about 1.11 km
    d = haversine_m(11.0, 76.0, 11.01, 76.0)
    assert 1100 < d < 1120


def test_inside_single_fence():
    assert not is_outside_all([fence(*CBE, 5000)], 11.02, 76.96)


def test_outside_single_fence():
    assert is_outside_all([fence(*CBE, 5000)], 11.2, 76.96)


def test_inside_any_of_several_fences_is_inside():
    fences = [fence(*CBE, 1000), fence(11.2, 76.96, 5000, "Erode")]
    assert not is_outside_all(fences, 11.2, 76.96)


def test_no_fences_is_never_outside():
    assert not is_outside_all([], 11.0, 76.0)


def test_nearest_fence_by_edge_distance():
    near = fence(11.03, 76.96, 500, "Near")
    far = fence(12.0, 77.0, 500, "Far")
    best, dist = nearest_fence([far, near], 11.05, 76.96)
    assert best.name == "Near"
    assert dist > 0
