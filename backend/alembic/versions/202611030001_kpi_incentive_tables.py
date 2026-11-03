"""Targets, KPI & Incentive module - phase 1: tables and seed data

Adds only the tables the module needs; everything else (users, farmers,
visits, trials, dealers, orders, products, day closures, leave, holidays)
is reused as is.

Conventions (from the build brief):
  * money is stored in paise as BIGINT - never floating point
  * percentages / rates are stored as decimals with 4 places
    (1.0000 = 100%, 0.0015 = 0.15%)
  * times are UTC (timestamptz); screens show IST
  * rules are versioned with effective_from; a period uses the version
    active on its start date

Seeded with the Excel sheets' levels, rates and weights. Admin-tunable
single values (conversion window, score ceiling, storage stages, ...) go
in the existing `settings` table under the `kpi.` prefix.

Land area note: the app stores land in CENTS (1 acre = 100 cents). The
"Area under trial" goal is shown in acres; the engine (phase 2) converts
visit_trial_details.trial_plot_size_cents / 100.

"Agreed for demo" already exists as visit_trial_details.demo_status
(agreed_not_started, started_today, followup_running, completed_*,
converted), so no new column is needed on visits.

Revision ID: 202611030001
Revises: 202610260001
"""
from alembic import op

revision = "202611030001"
down_revision = "202610260001"
branch_labels = None
depends_on = None

TABLES = [
    "kpi_audit_log", "incentive_statement", "performance_snapshot",
    "focus_product_plan", "sales_figure", "goal", "month_weight",
    "kpi_period", "grade_band", "incentive_rule_set", "kpi_weight_set", "kpi_item",
]


def upgrade() -> None:
    op.execute("""
        CREATE TABLE kpi_item (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            code varchar(40) NOT NULL UNIQUE,
            simple_name varchar(80) NOT NULL,
            help_text varchar(300),
            mode varchar(10) NOT NULL CHECK (mode IN ('field', 'sales')),
            unit varchar(20) NOT NULL,
            sort_order integer NOT NULL DEFAULT 0,
            active boolean NOT NULL DEFAULT true
        )
    """)

    op.execute("""
        CREATE TABLE kpi_weight_set (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            item_id uuid NOT NULL REFERENCES kpi_item(id) ON DELETE CASCADE,
            weight numeric(8,4) NOT NULL CHECK (weight >= 0),
            cap_pct numeric(8,4) NOT NULL DEFAULT 1.2000 CHECK (cap_pct >= 1),
            effective_from date NOT NULL,
            created_by uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (item_id, effective_from)
        )
    """)

    op.execute("""
        CREATE TABLE incentive_rule_set (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            level integer NOT NULL CHECK (level >= 1),
            sales_min_pct numeric(8,4) NOT NULL CHECK (sales_min_pct >= 0),
            sales_rate numeric(8,4) NOT NULL CHECK (sales_rate >= 0),
            coll_min_pct numeric(8,4) NOT NULL CHECK (coll_min_pct >= 0),
            coll_rate numeric(8,4) NOT NULL CHECK (coll_rate >= 0),
            entry_min_sales_pct numeric(8,4) NOT NULL DEFAULT 0.8000,
            level_gap integer NOT NULL DEFAULT 2 CHECK (level_gap >= 1),
            effective_from date NOT NULL,
            created_by uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (level, effective_from)
        )
    """)

    op.execute("""
        CREATE TABLE grade_band (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            grade varchar(2) NOT NULL,
            label varchar(40) NOT NULL,
            min_score numeric(8,2) NOT NULL,
            effective_from date NOT NULL,
            created_by uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (grade, effective_from)
        )
    """)

    op.execute("""
        CREATE TABLE kpi_period (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            type varchar(10) NOT NULL CHECK (type IN ('month', 'quarter')),
            start_date date NOT NULL,
            end_date date NOT NULL,
            status varchar(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
            closed_at timestamptz,
            closed_by uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            CHECK (end_date >= start_date),
            UNIQUE (type, start_date)
        )
    """)

    op.execute("""
        CREATE TABLE month_weight (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            region_id uuid NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
            year integer NOT NULL,
            month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
            weight numeric(8,4) NOT NULL CHECK (weight >= 0),
            UNIQUE (region_id, year, month)
        )
    """)

    # Monthly goals. value is a plain number in the item's unit (visits,
    # villages, acres, percent as 0.0000-1.0000 for trial_to_paid), except
    # sales/collection goals which are paise.
    op.execute("""
        CREATE TABLE goal (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            officer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            item_id uuid NOT NULL REFERENCES kpi_item(id) ON DELETE CASCADE,
            year integer NOT NULL,
            month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
            value numeric(18,4) NOT NULL CHECK (value >= 0),
            set_by uuid REFERENCES users(id) ON DELETE SET NULL,
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (officer_id, item_id, year, month)
        )
    """)
    op.execute("CREATE INDEX ix_goal_officer_period ON goal (officer_id, year, month)")

    op.execute("""
        CREATE TABLE sales_figure (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            officer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            year integer NOT NULL,
            month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
            sales_amount_paise bigint NOT NULL CHECK (sales_amount_paise >= 0),
            collection_amount_paise bigint NOT NULL CHECK (collection_amount_paise >= 0),
            source varchar(10) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
            entered_by uuid REFERENCES users(id) ON DELETE SET NULL,
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (officer_id, year, month)
        )
    """)

    op.execute("""
        CREATE TABLE focus_product_plan (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            period_id uuid NOT NULL REFERENCES kpi_period(id) ON DELETE CASCADE,
            officer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
            expected numeric(18,2) NOT NULL CHECK (expected >= 0),
            unit varchar(10) NOT NULL DEFAULT 'rupees' CHECK (unit IN ('rupees', 'units')),
            UNIQUE (period_id, officer_id, product_id)
        )
    """)

    op.execute("""
        CREATE TABLE performance_snapshot (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            officer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            period_id uuid NOT NULL REFERENCES kpi_period(id) ON DELETE CASCADE,
            snapshot_date date NOT NULL,
            items jsonb NOT NULL DEFAULT '{}'::jsonb,
            score numeric(8,2),
            grade varchar(2),
            sales_level integer,
            collection_level integer,
            level_match_applied boolean NOT NULL DEFAULT false,
            sales_incentive_paise bigint,
            collection_incentive_paise bigint,
            final_incentive_paise bigint,
            waiting_for_figures boolean NOT NULL DEFAULT false,
            rule_version date,
            stage varchar(10) NOT NULL DEFAULT 'live' CHECK (stage IN ('live', 'archive')),
            calculated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (officer_id, period_id, snapshot_date)
        )
    """)
    op.execute("CREATE INDEX ix_snapshot_period_date ON performance_snapshot (period_id, snapshot_date DESC)")

    op.execute("""
        CREATE TABLE incentive_statement (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            officer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            period_id uuid NOT NULL REFERENCES kpi_period(id) ON DELETE RESTRICT,
            inputs jsonb NOT NULL,
            rule_version date NOT NULL,
            final_amount_paise bigint NOT NULL CHECK (final_amount_paise >= 0),
            status varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
            approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
            approved_at timestamptz,
            paid_on date,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (officer_id, period_id)
        )
    """)

    op.execute("""
        CREATE TABLE kpi_audit_log (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            entity varchar(40) NOT NULL,
            entity_id uuid,
            action varchar(20) NOT NULL,
            old jsonb,
            new jsonb,
            reason varchar(300),
            user_id uuid REFERENCES users(id) ON DELETE SET NULL,
            at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX ix_kpi_audit_entity ON kpi_audit_log (entity, entity_id, at DESC)")

    _seed()


def _seed() -> None:
    # --- the 11 goal items: 5 field + 6 sales ---
    op.execute("""
        INSERT INTO kpi_item (code, simple_name, help_text, mode, unit, sort_order) VALUES
        ('farmers_visited',  'Farmers visited',        'Different farmers you met at least once.',                      'field', 'count',  1),
        ('villages_covered', 'Villages covered',       'Different villages you visited at least once.',                 'field', 'count',  2),
        ('demo_agreed',      'Farmers agreed for demo','Different farmers who agreed for a demo.',                      'field', 'count',  3),
        ('trial_area',       'Area under trial',       'Total acres of trials you started.',                            'field', 'acres',  4),
        ('trial_to_paid',    'Trial to paid',          'Farmers who bought within 60 days of a trial, out of all trials.', 'field', 'percent', 5),
        ('sales_done',       'Sales goal done',        'Your sales divided by your sales goal.',                        'sales', 'rupees', 6),
        ('focus_products',   'Focus products sold',    'Focus products sold compared with what was expected.',          'sales', 'rupees', 7),
        ('money_collected',  'Money collected',        'Money collected divided by your collection goal.',              'sales', 'rupees', 8),
        ('dealer_health',    'Active dealers',         'Dealers with at least one order, out of your dealer goal.',     'sales', 'count',  9),
        ('fo_follow_up',     'FO follow-up',           'Average score of the field officers who report to you.',        'sales', 'score',  10),
        ('daily_report',     'Daily report on time',   'Day closures sent the same day, out of working days.',          'sales', 'percent', 11)
    """)

    # --- marks (weights) from the Excel: field 5 x 20, sales 30/15/20/10/15/10 ---
    op.execute("""
        INSERT INTO kpi_weight_set (item_id, weight, cap_pct, effective_from)
        SELECT i.id, w.weight, 1.2000, DATE '2000-01-01'
        FROM kpi_item i
        JOIN (VALUES
            ('farmers_visited', 20), ('villages_covered', 20), ('demo_agreed', 20),
            ('trial_area', 20), ('trial_to_paid', 20),
            ('sales_done', 30), ('focus_products', 15), ('money_collected', 20),
            ('dealer_health', 10), ('fo_follow_up', 15), ('daily_report', 10)
        ) AS w(code, weight) ON w.code = i.code
    """)

    # --- incentive levels from the Incentive Calculator sheet ---
    op.execute("""
        INSERT INTO incentive_rule_set
            (level, sales_min_pct, sales_rate, coll_min_pct, coll_rate,
             entry_min_sales_pct, level_gap, effective_from) VALUES
        (1, 0.8000, 0.0015, 0.8500, 0.0125, 0.8000, 2, DATE '2000-01-01'),
        (2, 1.0000, 0.0025, 1.1000, 0.0150, 0.8000, 2, DATE '2000-01-01'),
        (3, 1.2000, 0.0050, 1.4000, 0.0175, 0.8000, 2, DATE '2000-01-01')
    """)

    # --- placeholder grade bands, to be confirmed by the company ---
    op.execute("""
        INSERT INTO grade_band (grade, label, min_score, effective_from) VALUES
        ('A', 'Outstanding',   90, DATE '2000-01-01'),
        ('B', 'Good',          75, DATE '2000-01-01'),
        ('C', 'Average',       60, DATE '2000-01-01'),
        ('D', 'Needs support',  0, DATE '2000-01-01')
    """)

    # --- single-value admin settings (existing `settings` table) ---
    op.execute("""
        INSERT INTO settings (key, value, description) VALUES
        ('kpi.conversion_window_days',   '60',    'Trial to paid: days after the trial a purchase still counts'),
        ('kpi.score_factor_max_pct',     '1.2',   'Highest score factor used on the incentive (1.2 = 120%)'),
        ('kpi.active_dealer_min_orders', '1',     'Orders a dealer needs in the period to count as active'),
        ('kpi.quarter_start_month',      '4',     'First month of the financial year (4 = April)'),
        ('kpi.field_incentive_enabled',  'false', 'Pay an incentive on the Field score (off until rates are given)'),
        ('kpi.nudges_enabled',           'true',  'Send friendly goal reminders (max 1 per day)'),
        ('kpi.entry_edit_days',          '3',     'Days an officer may edit their own entry'),
        ('kpi.live_days',                '60',    'Days full detail stays live'),
        ('kpi.archive_years',            '3',     'Years entries are kept read-only before permanent records only'),
        ('kpi.gps_retention_days',       '90',    'Days GPS route points are kept'),
        ('kpi.photo_archive_px',         '1280',  'Photos older than the live window are shrunk to this width')
        ON CONFLICT (key) DO NOTHING
    """)


def downgrade() -> None:
    for t in TABLES:
        op.execute(f"DROP TABLE IF EXISTS {t}")
    op.execute("DELETE FROM settings WHERE key LIKE 'kpi.%'")
