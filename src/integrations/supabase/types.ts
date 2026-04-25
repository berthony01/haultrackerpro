export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          admin_user_id: string
          created_at: string
          id: string
          metadata: Json | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          admin_user_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          admin_user_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      admin_users: {
        Row: {
          created_at: string
          email: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_insights: {
        Row: {
          content: string
          context_hash: string | null
          created_at: string
          generated_at: string
          id: string
          insight_type: string
          user_id: string
          week_start: string | null
        }
        Insert: {
          content: string
          context_hash?: string | null
          created_at?: string
          generated_at?: string
          id?: string
          insight_type: string
          user_id: string
          week_start?: string | null
        }
        Update: {
          content?: string
          context_hash?: string | null
          created_at?: string
          generated_at?: string
          id?: string
          insight_type?: string
          user_id?: string
          week_start?: string | null
        }
        Relationships: []
      }
      broker_stats: {
        Row: {
          avg_actual_pay: number
          avg_estimated_pay: number
          avg_variance_amount: number
          broker_id: string
          created_at: string
          days_to_invoice_avg: number | null
          days_to_pay_avg: number | null
          id: string
          last_load_date: string | null
          load_count: number
          reliability_score: number | null
          short_pay_count: number
          unpaid_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_actual_pay?: number
          avg_estimated_pay?: number
          avg_variance_amount?: number
          broker_id: string
          created_at?: string
          days_to_invoice_avg?: number | null
          days_to_pay_avg?: number | null
          id?: string
          last_load_date?: string | null
          load_count?: number
          reliability_score?: number | null
          short_pay_count?: number
          unpaid_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_actual_pay?: number
          avg_estimated_pay?: number
          avg_variance_amount?: number
          broker_id?: string
          created_at?: string
          days_to_invoice_avg?: number | null
          days_to_pay_avg?: number | null
          id?: string
          last_load_date?: string | null
          load_count?: number
          reliability_score?: number | null
          short_pay_count?: number
          unpaid_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_stats_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      brokers: {
        Row: {
          created_at: string
          email: string | null
          id: string
          mc_number: string | null
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          mc_number?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          mc_number?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      expense_automation_logs: {
        Row: {
          created_at: string
          id: string
          parse_confidence: number | null
          parsed_json: Json | null
          raw_text: string | null
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          parse_confidence?: number | null
          parsed_json?: Json | null
          raw_text?: string | null
          source: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          parse_confidence?: number | null
          parsed_json?: Json | null
          raw_text?: string | null
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          expense_date: string
          expense_type: string
          gallons: number | null
          id: string
          linked_load_id: string | null
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          expense_date: string
          expense_type?: string
          gallons?: number | null
          id?: string
          linked_load_id?: string | null
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          expense_date?: string
          expense_type?: string
          gallons?: number | null
          id?: string
          linked_load_id?: string | null
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_linked_load_id_fkey"
            columns: ["linked_load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_responses: {
        Row: {
          category: string | null
          created_at: string
          id: string
          loads_count: number
          response: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          loads_count?: number
          response: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          loads_count?: number
          response?: string
          user_id?: string
        }
        Relationships: []
      }
      fuel_logs: {
        Row: {
          created_at: string
          date: string
          gallons: number
          id: string
          linked_load_id: string | null
          notes: string | null
          odometer: number | null
          price_per_gallon: number
          station: string | null
          total_cost: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          gallons: number
          id?: string
          linked_load_id?: string | null
          notes?: string | null
          odometer?: number | null
          price_per_gallon: number
          station?: string | null
          total_cost: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          gallons?: number
          id?: string
          linked_load_id?: string | null
          notes?: string | null
          odometer?: number | null
          price_per_gallon?: number
          station?: string | null
          total_cost?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuel_logs_linked_load_id_fkey"
            columns: ["linked_load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
        ]
      }
      lane_stats: {
        Row: {
          avg_days_to_pay: number | null
          avg_deadhead_miles: number
          avg_loaded_miles: number
          avg_margin_pct: number
          avg_net_profit: number
          avg_rpm: number
          created_at: string
          destination_market: string | null
          id: string
          lane_key: string
          last_load_date: string | null
          load_count: number
          origin_market: string | null
          trend_direction: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_days_to_pay?: number | null
          avg_deadhead_miles?: number
          avg_loaded_miles?: number
          avg_margin_pct?: number
          avg_net_profit?: number
          avg_rpm?: number
          created_at?: string
          destination_market?: string | null
          id?: string
          lane_key: string
          last_load_date?: string | null
          load_count?: number
          origin_market?: string | null
          trend_direction?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_days_to_pay?: number | null
          avg_deadhead_miles?: number
          avg_loaded_miles?: number
          avg_margin_pct?: number
          avg_net_profit?: number
          avg_rpm?: number
          created_at?: string
          destination_market?: string | null
          id?: string
          lane_key?: string
          last_load_date?: string | null
          load_count?: number
          origin_market?: string | null
          trend_direction?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      load_stops: {
        Row: {
          created_at: string
          detention_minutes: number | null
          id: string
          load_id: string
          location: string
          stop_order: number
          stop_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          detention_minutes?: number | null
          id?: string
          load_id: string
          location: string
          stop_order: number
          stop_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          detention_minutes?: number | null
          id?: string
          load_id?: string
          location?: string
          stop_order?: number
          stop_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "load_stops_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
        ]
      }
      loads: {
        Row: {
          actual_pay_received: number | null
          broker_id: string | null
          broker_name_raw: string | null
          created_at: string
          deadhead_miles: number
          detention_fee: number
          dropoff_date: string | null
          dropoff_location: string
          estimated_pay: number | null
          gross_revenue: number | null
          id: string
          invoice_submitted_date: string | null
          load_date: string
          loaded_miles: number
          notes: string | null
          other_fees: number
          paid_date: string | null
          payment_due_date: string | null
          payment_notes: string | null
          payment_status: string
          pickup_location: string
          pod_submitted_date: string | null
          rate_per_mile: number
          short_paid_amount: number | null
          status: string
          updated_at: string
          user_id: string
          wait_fee: number
        }
        Insert: {
          actual_pay_received?: number | null
          broker_id?: string | null
          broker_name_raw?: string | null
          created_at?: string
          deadhead_miles?: number
          detention_fee?: number
          dropoff_date?: string | null
          dropoff_location: string
          estimated_pay?: number | null
          gross_revenue?: number | null
          id?: string
          invoice_submitted_date?: string | null
          load_date: string
          loaded_miles?: number
          notes?: string | null
          other_fees?: number
          paid_date?: string | null
          payment_due_date?: string | null
          payment_notes?: string | null
          payment_status?: string
          pickup_location: string
          pod_submitted_date?: string | null
          rate_per_mile?: number
          short_paid_amount?: number | null
          status?: string
          updated_at?: string
          user_id: string
          wait_fee?: number
        }
        Update: {
          actual_pay_received?: number | null
          broker_id?: string | null
          broker_name_raw?: string | null
          created_at?: string
          deadhead_miles?: number
          detention_fee?: number
          dropoff_date?: string | null
          dropoff_location?: string
          estimated_pay?: number | null
          gross_revenue?: number | null
          id?: string
          invoice_submitted_date?: string | null
          load_date?: string
          loaded_miles?: number
          notes?: string | null
          other_fees?: number
          paid_date?: string | null
          payment_due_date?: string | null
          payment_notes?: string | null
          payment_status?: string
          pickup_location?: string
          pod_submitted_date?: string | null
          rate_per_mile?: number
          short_paid_amount?: number | null
          status?: string
          updated_at?: string
          user_id?: string
          wait_fee?: number
        }
        Relationships: [
          {
            foreignKeyName: "loads_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      operating_metrics: {
        Row: {
          created_at: string
          id: string
          last_recomputed_at: string | null
          rolling_cost_per_mile: number
          rolling_deadhead_pct: number
          rolling_fuel_cost_per_mile: number
          rolling_margin_pct: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_recomputed_at?: string | null
          rolling_cost_per_mile?: number
          rolling_deadhead_pct?: number
          rolling_fuel_cost_per_mile?: number
          rolling_margin_pct?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_recomputed_at?: string | null
          rolling_cost_per_mile?: number
          rolling_deadhead_pct?: number
          rolling_fuel_cost_per_mile?: number
          rolling_margin_pct?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      parse_usage: {
        Row: {
          id: string
          used_at: string
          user_id: string
        }
        Insert: {
          id?: string
          used_at?: string
          user_id: string
        }
        Update: {
          id?: string
          used_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_expires_at: string | null
          subscription_plan: string | null
          subscription_status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_expires_at?: string | null
          subscription_plan?: string | null
          subscription_status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_expires_at?: string | null
          subscription_plan?: string | null
          subscription_status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      recurring_expense_templates: {
        Row: {
          amount: number
          category: string
          created_at: string
          end_date: string | null
          expense_type: string
          frequency: string
          id: string
          is_active: boolean
          last_generated_date: string | null
          notes: string | null
          pause_reason: string | null
          paused_at: string | null
          resumed_at: string | null
          start_date: string
          status: string
          template_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          end_date?: string | null
          expense_type?: string
          frequency?: string
          id?: string
          is_active?: boolean
          last_generated_date?: string | null
          notes?: string | null
          pause_reason?: string | null
          paused_at?: string | null
          resumed_at?: string | null
          start_date: string
          status?: string
          template_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          end_date?: string | null
          expense_type?: string
          frequency?: string
          id?: string
          is_active?: boolean
          last_generated_date?: string | null
          notes?: string | null
          pause_reason?: string | null
          paused_at?: string | null
          resumed_at?: string | null
          start_date?: string
          status?: string
          template_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan_key: string
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          trial_start: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_key?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_key?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_alerts: {
        Row: {
          created_at: string
          dedupe_key: string
          dismissed_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          dismissed_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          dismissed_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          buffer_percent: number | null
          company_name: string | null
          company_start_date: string | null
          created_at: string
          currency: string
          default_other_fees: number | null
          default_rate_per_mile: number | null
          federal_tax_percent: number | null
          home_time_ended_at: string | null
          home_time_mode: boolean
          home_time_paused_template_ids: string[]
          home_time_started_at: string | null
          id: string
          include_se_tax: boolean | null
          lifecycle_emails_opt_in: boolean
          onboarding_completed: boolean
          pay_percentage: number | null
          pay_type: string
          se_tax_percent: number | null
          state_tax_percent: number | null
          target_deadhead_pct: number | null
          target_margin_pct: number | null
          target_rpm: number | null
          tax_base_type: string | null
          tax_estimator_enabled: boolean
          tax_reminder_offsets: number[] | null
          tax_reminders_enabled: boolean
          updated_at: string
          user_id: string
          week_start_day: string
        }
        Insert: {
          buffer_percent?: number | null
          company_name?: string | null
          company_start_date?: string | null
          created_at?: string
          currency?: string
          default_other_fees?: number | null
          default_rate_per_mile?: number | null
          federal_tax_percent?: number | null
          home_time_ended_at?: string | null
          home_time_mode?: boolean
          home_time_paused_template_ids?: string[]
          home_time_started_at?: string | null
          id?: string
          include_se_tax?: boolean | null
          lifecycle_emails_opt_in?: boolean
          onboarding_completed?: boolean
          pay_percentage?: number | null
          pay_type?: string
          se_tax_percent?: number | null
          state_tax_percent?: number | null
          target_deadhead_pct?: number | null
          target_margin_pct?: number | null
          target_rpm?: number | null
          tax_base_type?: string | null
          tax_estimator_enabled?: boolean
          tax_reminder_offsets?: number[] | null
          tax_reminders_enabled?: boolean
          updated_at?: string
          user_id: string
          week_start_day?: string
        }
        Update: {
          buffer_percent?: number | null
          company_name?: string | null
          company_start_date?: string | null
          created_at?: string
          currency?: string
          default_other_fees?: number | null
          default_rate_per_mile?: number | null
          federal_tax_percent?: number | null
          home_time_ended_at?: string | null
          home_time_mode?: boolean
          home_time_paused_template_ids?: string[]
          home_time_started_at?: string | null
          id?: string
          include_se_tax?: boolean | null
          lifecycle_emails_opt_in?: boolean
          onboarding_completed?: boolean
          pay_percentage?: number | null
          pay_type?: string
          se_tax_percent?: number | null
          state_tax_percent?: number | null
          target_deadhead_pct?: number | null
          target_margin_pct?: number | null
          target_rpm?: number | null
          tax_base_type?: string | null
          tax_estimator_enabled?: boolean
          tax_reminder_offsets?: number[] | null
          tax_reminders_enabled?: boolean
          updated_at?: string
          user_id?: string
          week_start_day?: string
        }
        Relationships: []
      }
      weekly_snapshots: {
        Row: {
          created_at: string
          deadhead_percentage: number
          finalized_at: string
          id: string
          known_difference: number
          total_actual_pay: number
          total_deadhead_miles: number
          total_estimated_pay: number
          total_loaded_miles: number
          total_loads: number
          unpaid_count: number
          unpaid_estimated: number
          user_id: string
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          deadhead_percentage?: number
          finalized_at?: string
          id?: string
          known_difference?: number
          total_actual_pay?: number
          total_deadhead_miles?: number
          total_estimated_pay?: number
          total_loaded_miles?: number
          total_loads?: number
          unpaid_count?: number
          unpaid_estimated?: number
          user_id: string
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          deadhead_percentage?: number
          finalized_at?: string
          id?: string
          known_difference?: number
          total_actual_pay?: number
          total_deadhead_miles?: number
          total_estimated_pay?: number
          total_loaded_miles?: number
          total_loads?: number
          unpaid_count?: number
          unpaid_estimated?: number
          user_id?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      build_lane_key: {
        Args: { _dropoff: string; _pickup: string }
        Returns: string
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      expire_ended_trials: { Args: never; Returns: undefined }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      recompute_broker_stats: { Args: { _user_id: string }; Returns: undefined }
      recompute_lane_stats: { Args: { _user_id: string }; Returns: undefined }
      recompute_operating_metrics: {
        Args: { _user_id: string }
        Returns: undefined
      }
      recompute_personal_intelligence: {
        Args: { _user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
