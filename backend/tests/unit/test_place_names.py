from app.application.services.place_name_service import compose_name


def test_street_area_city():
    payload = {
        "name": "",
        "address": {"road": "Perur Road", "suburb": "Sundarapuram", "city": "Coimbatore", "state": "Tamil Nadu"},
    }
    assert compose_name(payload) == "Perur Road, Sundarapuram, Coimbatore"


def test_named_place_wins_over_road():
    payload = {
        "name": "Sri Lakshmi Agro Centre",
        "address": {"shop": "Sri Lakshmi Agro Centre", "road": "Mettupalayam Road", "town": "Annur"},
    }
    assert compose_name(payload) == "Sri Lakshmi Agro Centre, Annur"


def test_village_only():
    assert compose_name({"address": {"village": "Kovilpalayam", "county": "Coimbatore"}}) == "Kovilpalayam, Coimbatore"


def test_nothing_usable():
    assert compose_name({"address": {"country": "India"}}) is None
    assert compose_name({}) is None
    assert compose_name({"address": "oops"}) is None


def test_yes_is_not_a_name():
    assert compose_name({"address": {"building": "yes", "road": "Gandhi Road", "city": "Erode"}}) == "Gandhi Road, Erode"
