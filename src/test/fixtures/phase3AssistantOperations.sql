-- Minimal faithful projections of operational tables read by the Phase3B
-- registered projections. Column names/types match live generated types; only
-- accessed fields, owner keys, and forbidden sentinel fields (to prove absence).
CREATE TABLE public.loads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,load_date date NOT NULL,
 status text NOT NULL DEFAULT 'booked',payment_status text NOT NULL DEFAULT 'unpaid',estimated_pay numeric,actual_pay_received numeric,
 notes text,broker_name_raw text,load_reference text,pickup_location text NOT NULL DEFAULT 'Origin, ST',dropoff_location text NOT NULL DEFAULT 'Dest, ST',
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.expenses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,expense_date date NOT NULL,
 category text NOT NULL,amount numeric NOT NULL,expense_type text NOT NULL DEFAULT 'variable',notes text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.opportunities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),recruiter_id uuid NOT NULL REFERENCES public.recruiter_profiles(id) ON DELETE CASCADE,
 title text NOT NULL,status text NOT NULL DEFAULT 'draft',route_type text,description text,company_name text NOT NULL DEFAULT 'Local Company',
 updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.opportunity_applications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
 recruiter_id uuid NOT NULL,driver_user_id uuid NOT NULL,status text NOT NULL DEFAULT 'submitted',driver_email_snapshot text,driver_phone_snapshot text,message text);
CREATE TABLE public.conversation_threads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),recruiter_id uuid NOT NULL,driver_user_id uuid NOT NULL,
 initiated_by_user_id uuid NOT NULL,status text NOT NULL DEFAULT 'pending');
CREATE TABLE public.agency_service_packages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
 name text NOT NULL,description text,price_display_text text,billing_frequency_display_text text,is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TYPE public.agency_work_item_status AS ENUM('open','in_progress','waiting_on_driver','completed','cancelled');
CREATE TABLE public.agency_work_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
 driver_user_id uuid NOT NULL,title text NOT NULL DEFAULT 'Item',description text,status public.agency_work_item_status NOT NULL DEFAULT 'open');
CREATE TYPE public.agency_client_request_status AS ENUM('pending','approved','declined','cancelled','converted_to_client');
CREATE TABLE public.agency_client_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),agency_id uuid NOT NULL REFERENCES public.agency_profiles(id) ON DELETE CASCADE,
 driver_user_id uuid NOT NULL,phone text,message text,status public.agency_client_request_status NOT NULL DEFAULT 'pending');
