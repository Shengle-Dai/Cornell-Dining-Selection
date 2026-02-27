-- Campus Meal Pick — Supabase schema
-- Run this in the Supabase SQL editor after enabling pgvector.

CREATE EXTENSION IF NOT EXISTS vector;

-- ─── profiles ───────────────────────────────────────────────────────────────
-- Replaces sub:{email}. Auto-populated via trigger on Google OAuth sign-up.

CREATE TABLE public.profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email       TEXT NOT NULL UNIQUE,
    subscribed  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger: auto-create profile on sign-up (restrict to .edu emails)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.email NOT LIKE '%@%.edu' THEN
        RAISE EXCEPTION 'Only .edu email addresses are allowed';
    END IF;
    INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── dishes ─────────────────────────────────────────────────────────────────
-- Replaces dish:{normalized_name}. 300-dim food2vec embedding.

CREATE TABLE public.dishes (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    normalized_name     TEXT NOT NULL UNIQUE,
    source_name         TEXT,
    ingredients         TEXT[] NOT NULL DEFAULT '{}',
    embedding           vector(300),
    flavor_profiles     TEXT[] NOT NULL DEFAULT '{}',
    cooking_methods     TEXT[] NOT NULL DEFAULT '{}',
    cuisine_type        TEXT NOT NULL DEFAULT 'other',
    dietary_attrs       TEXT[] NOT NULL DEFAULT '{}',
    dish_type           TEXT NOT NULL DEFAULT 'main',
    is_onboarding_dish  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dishes_embedding ON public.dishes
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- ─── user_preferences ───────────────────────────────────────────────────────
-- Replaces initial_categories/initial_ingredients + preference_vector from pref:{email}

CREATE TABLE public.user_preferences (
    user_id                UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    initial_categories     TEXT[] NOT NULL DEFAULT '{}',
    initial_ingredients    TEXT[] NOT NULL DEFAULT '{}',
    preference_vector      vector(300),
    vector_stale           BOOLEAN NOT NULL DEFAULT TRUE,
    preferred_flavors      TEXT[] NOT NULL DEFAULT '{}',
    preferred_methods      TEXT[] NOT NULL DEFAULT '{}',
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── ratings ────────────────────────────────────────────────────────────────
-- Replaces liked_dishes/disliked_dishes arrays from pref:{email}

CREATE TABLE public.ratings (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    dish_id     BIGINT NOT NULL REFERENCES public.dishes(id) ON DELETE CASCADE,
    rating      SMALLINT NOT NULL CHECK (rating IN (1, -1)),
    strength    FLOAT NOT NULL DEFAULT 1.0,
    menu_date   DATE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, dish_id, menu_date)
);

CREATE INDEX idx_ratings_user ON public.ratings(user_id, created_at DESC);

-- ─── daily_menus ────────────────────────────────────────────────────────────
-- Replaces menu:{date}. Links dishes to eateries/buckets on a given day.

CREATE TABLE public.daily_menus (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    menu_date   DATE NOT NULL,
    dish_id     BIGINT NOT NULL REFERENCES public.dishes(id) ON DELETE CASCADE,
    eatery      TEXT NOT NULL,
    bucket      TEXT NOT NULL CHECK (bucket IN ('breakfast_brunch', 'lunch', 'dinner')),
    UNIQUE(menu_date, dish_id, eatery, bucket)
);

CREATE INDEX idx_daily_menus_date ON public.daily_menus(menu_date);

-- ─── Row Level Security ─────────────────────────────────────────────────────
-- Users read/update own data; service role bypasses for Python pipeline.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_menus ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own profile"   ON public.profiles          FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles          FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users read own prefs"     ON public.user_preferences  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users upsert own prefs"   ON public.user_preferences  FOR ALL    USING (auth.uid() = user_id);
CREATE POLICY "Users manage own ratings" ON public.ratings           FOR ALL    USING (auth.uid() = user_id);
CREATE POLICY "Auth users read dishes"   ON public.dishes            FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Auth users read menus"    ON public.daily_menus       FOR SELECT USING (auth.role() = 'authenticated');
