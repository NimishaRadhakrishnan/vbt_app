"""create vishakan business schema (attendance, plans, farmers, dealers, orders, crop issues, notifications, visits, etc.)

Revision ID: 202607240002
Revises: 202607240001
Create Date: 2026-07-27 00:02:00

Context: backend/schema.sql already defined this entire schema correctly —
but nothing in docker-compose.yml or anywhere else ever executed that file
against a real database (no docker-entrypoint-initdb.d mount, no init
script, no Alembic migration). Every router built against these tables
(attendance, planning, farmer, dealer, crop_issue, notification, visit)
was fully implemented and completely non-functional in any real deployment,
failing with "relation does not exist" — the exact same failure mode
diagnosed for officer_locations in the previous migration, just systemic
across nearly the whole app.

This migration is schema.sql's content, translated into a proper,
versioned Alembic migration. schema.sql is removed in this same change —
see CHANGELOG_FIXES_V2.md — since a duplicate, never-executed copy of the
schema is worse than no copy: it actively misleads anyone reading the repo
into believing the tables already exist.

officer_locations and gps_tracks are intentionally excluded here — they
were already created by 202607240001.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "202607240002"
down_revision: str | None = "202607240001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


SCHEMA_SQL = """
-- Device Registry
CREATE TABLE IF NOT EXISTS device_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_uuid VARCHAR(100) UNIQUE NOT NULL,
    push_token VARCHAR(255),
    os_type VARCHAR(20) NOT NULL,
    os_version VARCHAR(20),
    app_version VARCHAR(20),
    is_bound BOOLEAN NOT NULL DEFAULT TRUE,
    registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_device_user ON device_registry(user_id);

-- Territories
CREATE TABLE IF NOT EXISTS territories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    district VARCHAR(100) NOT NULL,
    taluk VARCHAR(100),
    village VARCHAR(100),
    boundary GEOGRAPHY(Polygon, 4326),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_territories_boundary ON territories USING GIST(boundary);

-- User Territory Mapping
CREATE TABLE IF NOT EXISTS user_territories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    territory_id UUID NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, territory_id)
);

-- Attendance
CREATE TABLE IF NOT EXISTS attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    check_in_time TIMESTAMP WITH TIME ZONE NOT NULL,
    check_out_time TIMESTAMP WITH TIME ZONE,
    check_in_location GEOGRAPHY(Point, 4326) NOT NULL,
    check_out_location GEOGRAPHY(Point, 4326),
    check_in_device_id VARCHAR(100) NOT NULL,
    check_in_phone VARCHAR(50),
    is_fake_gps BOOLEAN NOT NULL DEFAULT FALSE,
    is_gps_disabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, date);

-- Weekly Plans
CREATE TABLE IF NOT EXISTS weekly_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start_date DATE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'needs_modification', 'escalated')),
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    manager_comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, week_start_date)
);

-- Weekly Plan Activities
CREATE TABLE IF NOT EXISTS weekly_plan_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    weekly_plan_id UUID NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    territory_id UUID NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
    planned_villages TEXT[],
    planned_dealers TEXT[],
    activity_type VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Weekly Plan Deviations
CREATE TABLE IF NOT EXISTS weekly_plan_deviations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    weekly_plan_id UUID NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    reason VARCHAR(50) NOT NULL CHECK (reason IN ('Rain', 'Farmer unavailable', 'Emergency', 'Vehicle issue', 'Medical', 'Other')),
    details TEXT NOT NULL,
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Farmers
CREATE TABLE IF NOT EXISTS farmers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    phone VARCHAR(50) UNIQUE NOT NULL,
    village VARCHAR(100) NOT NULL,
    taluk VARCHAR(100) NOT NULL,
    district VARCHAR(100) NOT NULL,
    location GEOGRAPHY(Point, 4326),
    crop VARCHAR(100) NOT NULL,
    acres DOUBLE PRECISION NOT NULL,
    photo_url VARCHAR(500),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_farmers_district ON farmers(district);
CREATE INDEX IF NOT EXISTS idx_farmers_phone ON farmers(phone);

-- Dealers
CREATE TABLE IF NOT EXISTS dealers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    phone VARCHAR(50) UNIQUE NOT NULL,
    village VARCHAR(100),
    taluk VARCHAR(100),
    district VARCHAR(100) NOT NULL,
    location GEOGRAPHY(Point, 4326),
    address TEXT,
    contact_person VARCHAR(150),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dealers_district ON dealers(district);

-- Products
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) UNIQUE NOT NULL,
    category VARCHAR(100) NOT NULL,
    sku_code VARCHAR(100) UNIQUE NOT NULL,
    price DECIMAL(12, 2) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Dealer Stock Monitoring
CREATE TABLE IF NOT EXISTS dealer_stocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
    low_stock_threshold INTEGER NOT NULL DEFAULT 10,
    last_updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(dealer_id, product_id)
);

-- Dealer Orders
CREATE TABLE IF NOT EXISTS dealer_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'packed', 'dispatched', 'delivered', 'cancelled')),
    order_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    comments TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Order Items
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES dealer_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(12, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Stock Movements Ledger
CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL,
    movement_type VARCHAR(30) NOT NULL CHECK (movement_type IN ('inbound_order', 'sales_out', 'stock_adjustment', 'return')),
    notes TEXT,
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Officer Visits
CREATE TABLE IF NOT EXISTS visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visit_type VARCHAR(20) NOT NULL CHECK (visit_type IN ('farmer', 'dealer')),
    farmer_id UUID REFERENCES farmers(id) ON DELETE SET NULL,
    dealer_id UUID REFERENCES dealers(id) ON DELETE SET NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    location_start GEOGRAPHY(Point, 4326) NOT NULL,
    location_end GEOGRAPHY(Point, 4326),
    photo_url_farmer VARCHAR(500),
    photo_url_farm VARCHAR(500),
    crop VARCHAR(100),
    purpose VARCHAR(255),
    products_demonstrated TEXT[],
    task_completed BOOLEAN NOT NULL DEFAULT TRUE,
    next_visit_date DATE,
    voice_notes_url VARCHAR(500),
    voice_notes_transcript_ta TEXT,
    voice_notes_transcript_en TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_visit_target CHECK (
        (visit_type = 'farmer' AND farmer_id IS NOT NULL AND dealer_id IS NULL) OR
        (visit_type = 'dealer' AND dealer_id IS NOT NULL AND farmer_id IS NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_visits_user_time ON visits(user_id, start_time DESC);

-- Crop Issues
CREATE TABLE IF NOT EXISTS crop_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    farmer_id UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    image_url VARCHAR(500),
    symptoms TEXT NOT NULL,
    voice_notes_url VARCHAR(500),
    crop VARCHAR(100) NOT NULL,
    district VARCHAR(100) NOT NULL,
    assigned_expert_whatsapp VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'closed')),
    expert_reply TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- System Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('disease_uploaded', 'weekly_target_missed', 'outside_territory', 'low_dealer_stock', 'approval_update', 'broadcast', 'task_assigned', 'task_completed')),
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);

-- Notification Templates
CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) UNIQUE NOT NULL,
    title_template VARCHAR(255) NOT NULL,
    body_template TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Holiday Calendar
CREATE TABLE IF NOT EXISTS holiday_calendar (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE UNIQUE NOT NULL,
    description VARCHAR(200) NOT NULL,
    is_national BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Expenses Ledger
CREATE TABLE IF NOT EXISTS expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN ('fuel', 'lodging', 'food', 'farmer_meeting', 'other')),
    receipt_url VARCHAR(500),
    status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_by UUID REFERENCES users(id),
    comments TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- System Settings
CREATE TABLE IF NOT EXISTS settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) UNIQUE NOT NULL,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
"""

DROP_SQL_IN_REVERSE_ORDER = """
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS holiday_calendar;
DROP TABLE IF EXISTS notification_templates;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS crop_issues;
DROP TABLE IF EXISTS visits;
DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS dealer_orders;
DROP TABLE IF EXISTS dealer_stocks;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS dealers;
DROP TABLE IF EXISTS farmers;
DROP TABLE IF EXISTS weekly_plan_deviations;
DROP TABLE IF EXISTS weekly_plan_activities;
DROP TABLE IF EXISTS weekly_plans;
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS user_territories;
DROP TABLE IF EXISTS territories;
DROP TABLE IF EXISTS device_registry;
"""


def upgrade() -> None:
    op.execute(SCHEMA_SQL)


def downgrade() -> None:
    op.execute(DROP_SQL_IN_REVERSE_ORDER)
