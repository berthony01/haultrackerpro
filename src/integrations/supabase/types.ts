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
      application_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          application_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json
        }
        Insert: {
          actor_type: string
          actor_user_id?: string | null
          application_id: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          application_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "application_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "opportunity_applications"
            referencedColumns: ["id"]
          },
        ]
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
      contract_audit_log: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          contract_id: string
          created_at: string
          id: string
          metadata: Json
          version_id: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          contract_id: string
          created_at?: string
          id?: string
          metadata?: Json
          version_id?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          contract_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_audit_log_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_audit_log_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "contract_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_clauses: {
        Row: {
          clause_type: string
          contract_id: string
          created_at: string
          id: string
          metadata: Json
          page_ref: number | null
          raw_excerpt: string | null
          severity: string
          summary: string | null
          version_id: string
        }
        Insert: {
          clause_type: string
          contract_id: string
          created_at?: string
          id?: string
          metadata?: Json
          page_ref?: number | null
          raw_excerpt?: string | null
          severity?: string
          summary?: string | null
          version_id: string
        }
        Update: {
          clause_type?: string
          contract_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          page_ref?: number | null
          raw_excerpt?: string | null
          severity?: string
          summary?: string | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_clauses_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_clauses_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "contract_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_reviews: {
        Row: {
          ai_findings: Json | null
          ai_summary: string | null
          contract_id: string
          created_at: string
          decision: string | null
          id: string
          notes: string | null
          reviewer_role: string
          reviewer_user_id: string | null
          updated_at: string
          version_id: string | null
        }
        Insert: {
          ai_findings?: Json | null
          ai_summary?: string | null
          contract_id: string
          created_at?: string
          decision?: string | null
          id?: string
          notes?: string | null
          reviewer_role: string
          reviewer_user_id?: string | null
          updated_at?: string
          version_id?: string | null
        }
        Update: {
          ai_findings?: Json | null
          ai_summary?: string | null
          contract_id?: string
          created_at?: string
          decision?: string | null
          id?: string
          notes?: string | null
          reviewer_role?: string
          reviewer_user_id?: string | null
          updated_at?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_reviews_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_reviews_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "contract_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_signatures: {
        Row: {
          contract_id: string
          created_at: string
          evidence: Json
          id: string
          ip_address: string | null
          signature_method: string
          signed_at: string | null
          signer_role: string
          signer_user_id: string
          user_agent: string | null
          version_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          evidence?: Json
          id?: string
          ip_address?: string | null
          signature_method?: string
          signed_at?: string | null
          signer_role: string
          signer_user_id: string
          user_agent?: string | null
          version_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          evidence?: Json
          id?: string
          ip_address?: string | null
          signature_method?: string
          signed_at?: string | null
          signer_role?: string
          signer_user_id?: string
          user_agent?: string | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_signatures_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_signatures_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "contract_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_versions: {
        Row: {
          contract_id: string
          created_at: string
          extracted_text: string | null
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          page_count: number | null
          parse_error: string | null
          parse_status: string
          storage_bucket: string
          storage_path: string
          updated_at: string
          upload_status: string
          uploaded_at: string | null
          uploaded_by: string
          version_number: number
        }
        Insert: {
          contract_id: string
          created_at?: string
          extracted_text?: string | null
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          page_count?: number | null
          parse_error?: string | null
          parse_status?: string
          storage_bucket?: string
          storage_path: string
          updated_at?: string
          upload_status?: string
          uploaded_at?: string | null
          uploaded_by: string
          version_number: number
        }
        Update: {
          contract_id?: string
          created_at?: string
          extracted_text?: string | null
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          page_count?: number | null
          parse_error?: string | null
          parse_status?: string
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          upload_status?: string
          uploaded_at?: string | null
          uploaded_by?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "contract_versions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          application_id: string
          created_at: string
          current_version_id: string | null
          driver_user_id: string
          id: string
          metadata: Json
          opportunity_id: string
          recruiter_id: string
          recruiter_user_id: string
          risk_score: number | null
          risk_tier: string | null
          status: Database["public"]["Enums"]["contract_status"]
          title: string | null
          updated_at: string
        }
        Insert: {
          application_id: string
          created_at?: string
          current_version_id?: string | null
          driver_user_id: string
          id?: string
          metadata?: Json
          opportunity_id: string
          recruiter_id: string
          recruiter_user_id: string
          risk_score?: number | null
          risk_tier?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          title?: string | null
          updated_at?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          current_version_id?: string | null
          driver_user_id?: string
          id?: string
          metadata?: Json
          opportunity_id?: string
          recruiter_id?: string
          recruiter_user_id?: string
          risk_score?: number | null
          risk_tier?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_application_fk"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "opportunity_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "contract_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_opportunity_fk"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_recruiter_fk"
            columns: ["recruiter_id"]
            isOneToOne: false
            referencedRelation: "recruiter_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_profile: {
        Row: {
          avg_mpg: number | null
          created_at: string
          days_per_1000_miles: number | null
          diesel_price_per_gallon: number | null
          eld_software_monthly: number | null
          estimated_monthly_miles: number | null
          id: string
          insurance_monthly: number | null
          lodging_per_day: number | null
          maintenance_per_mile: number | null
          meals_per_day: number | null
          min_margin_pct: number | null
          min_rpm: number | null
          other_fixed_monthly: number | null
          permits_licensing_monthly: number | null
          tires_per_mile: number | null
          tolls_per_mile: number | null
          trailer_payment: number | null
          truck_payment: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_mpg?: number | null
          created_at?: string
          days_per_1000_miles?: number | null
          diesel_price_per_gallon?: number | null
          eld_software_monthly?: number | null
          estimated_monthly_miles?: number | null
          id?: string
          insurance_monthly?: number | null
          lodging_per_day?: number | null
          maintenance_per_mile?: number | null
          meals_per_day?: number | null
          min_margin_pct?: number | null
          min_rpm?: number | null
          other_fixed_monthly?: number | null
          permits_licensing_monthly?: number | null
          tires_per_mile?: number | null
          tolls_per_mile?: number | null
          trailer_payment?: number | null
          truck_payment?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_mpg?: number | null
          created_at?: string
          days_per_1000_miles?: number | null
          diesel_price_per_gallon?: number | null
          eld_software_monthly?: number | null
          estimated_monthly_miles?: number | null
          id?: string
          insurance_monthly?: number | null
          lodging_per_day?: number | null
          maintenance_per_mile?: number | null
          meals_per_day?: number | null
          min_margin_pct?: number | null
          min_rpm?: number | null
          other_fixed_monthly?: number | null
          permits_licensing_monthly?: number | null
          tires_per_mile?: number | null
          tolls_per_mile?: number | null
          trailer_payment?: number | null
          truck_payment?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      driver_opportunity_profiles: {
        Row: {
          allow_verified_recruiter_contact: boolean
          available_start_date: string | null
          cdl_class: string | null
          city: string | null
          contact_preference: string
          created_at: string
          email: string | null
          endorsements: string[]
          full_name: string | null
          id: string
          min_effective_rpm: number | null
          min_weekly_gross: number | null
          min_weekly_net: number | null
          phone: string | null
          preferred_driver_type: string | null
          preferred_home_time: string | null
          preferred_route_type: string | null
          preferred_states: string[]
          profile_completed: boolean
          state: string | null
          trailer_experience: string[]
          updated_at: string
          user_id: string
          visibility: string
          willing_to_relocate: boolean
          years_experience: number | null
        }
        Insert: {
          allow_verified_recruiter_contact?: boolean
          available_start_date?: string | null
          cdl_class?: string | null
          city?: string | null
          contact_preference?: string
          created_at?: string
          email?: string | null
          endorsements?: string[]
          full_name?: string | null
          id?: string
          min_effective_rpm?: number | null
          min_weekly_gross?: number | null
          min_weekly_net?: number | null
          phone?: string | null
          preferred_driver_type?: string | null
          preferred_home_time?: string | null
          preferred_route_type?: string | null
          preferred_states?: string[]
          profile_completed?: boolean
          state?: string | null
          trailer_experience?: string[]
          updated_at?: string
          user_id: string
          visibility?: string
          willing_to_relocate?: boolean
          years_experience?: number | null
        }
        Update: {
          allow_verified_recruiter_contact?: boolean
          available_start_date?: string | null
          cdl_class?: string | null
          city?: string | null
          contact_preference?: string
          created_at?: string
          email?: string | null
          endorsements?: string[]
          full_name?: string | null
          id?: string
          min_effective_rpm?: number | null
          min_weekly_gross?: number | null
          min_weekly_net?: number | null
          phone?: string | null
          preferred_driver_type?: string | null
          preferred_home_time?: string | null
          preferred_route_type?: string | null
          preferred_states?: string[]
          profile_completed?: boolean
          state?: string | null
          trailer_experience?: string[]
          updated_at?: string
          user_id?: string
          visibility?: string
          willing_to_relocate?: boolean
          years_experience?: number | null
        }
        Relationships: []
      }
      driver_points: {
        Row: {
          best_weekly_period_start: string | null
          best_weekly_points: number
          last_activity_date: string | null
          load_points: number
          parking_points: number
          streak_days: number
          total_points: number
          updated_at: string
          user_id: string
          weekly_period_start: string | null
          weekly_points: number
        }
        Insert: {
          best_weekly_period_start?: string | null
          best_weekly_points?: number
          last_activity_date?: string | null
          load_points?: number
          parking_points?: number
          streak_days?: number
          total_points?: number
          updated_at?: string
          user_id: string
          weekly_period_start?: string | null
          weekly_points?: number
        }
        Update: {
          best_weekly_period_start?: string | null
          best_weekly_points?: number
          last_activity_date?: string | null
          load_points?: number
          parking_points?: number
          streak_days?: number
          total_points?: number
          updated_at?: string
          user_id?: string
          weekly_period_start?: string | null
          weekly_points?: number
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
      lead_magnet_signups: {
        Row: {
          bundle_name: string
          bundle_version: string
          converted_user_id: string | null
          created_at: string
          download_sent_at: string | null
          downloaded_at: string | null
          email: string
          email_lower: string | null
          first_name: string | null
          id: string
          source_page: string | null
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          bundle_name?: string
          bundle_version?: string
          converted_user_id?: string | null
          created_at?: string
          download_sent_at?: string | null
          downloaded_at?: string | null
          email: string
          email_lower?: string | null
          first_name?: string | null
          id?: string
          source_page?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          bundle_name?: string
          bundle_version?: string
          converted_user_id?: string | null
          created_at?: string
          download_sent_at?: string | null
          downloaded_at?: string | null
          email?: string
          email_lower?: string | null
          first_name?: string | null
          id?: string
          source_page?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
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
          deadhead_pay_amount: number | null
          deadhead_pay_status: string | null
          deadhead_rate_per_mile: number | null
          detention_fee: number
          dropoff_date: string | null
          dropoff_location: string
          estimated_pay: number | null
          flat_rate_amount: number | null
          gross_revenue: number | null
          id: string
          invoice_submitted_date: string | null
          load_date: string
          loaded_miles: number
          notes: string | null
          other_fees: number
          paid_date: string | null
          pay_model: string | null
          payment_due_date: string | null
          payment_notes: string | null
          payment_status: string
          pickup_location: string
          pod_submitted_date: string | null
          rate_per_mile: number
          short_paid_amount: number | null
          status: string
          total_miles: number | null
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
          deadhead_pay_amount?: number | null
          deadhead_pay_status?: string | null
          deadhead_rate_per_mile?: number | null
          detention_fee?: number
          dropoff_date?: string | null
          dropoff_location: string
          estimated_pay?: number | null
          flat_rate_amount?: number | null
          gross_revenue?: number | null
          id?: string
          invoice_submitted_date?: string | null
          load_date: string
          loaded_miles?: number
          notes?: string | null
          other_fees?: number
          paid_date?: string | null
          pay_model?: string | null
          payment_due_date?: string | null
          payment_notes?: string | null
          payment_status?: string
          pickup_location: string
          pod_submitted_date?: string | null
          rate_per_mile?: number
          short_paid_amount?: number | null
          status?: string
          total_miles?: number | null
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
          deadhead_pay_amount?: number | null
          deadhead_pay_status?: string | null
          deadhead_rate_per_mile?: number | null
          detention_fee?: number
          dropoff_date?: string | null
          dropoff_location?: string
          estimated_pay?: number | null
          flat_rate_amount?: number | null
          gross_revenue?: number | null
          id?: string
          invoice_submitted_date?: string | null
          load_date?: string
          loaded_miles?: number
          notes?: string | null
          other_fees?: number
          paid_date?: string | null
          pay_model?: string | null
          payment_due_date?: string | null
          payment_notes?: string | null
          payment_status?: string
          pickup_location?: string
          pod_submitted_date?: string | null
          rate_per_mile?: number
          short_paid_amount?: number | null
          status?: string
          total_miles?: number | null
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
      notification_preferences: {
        Row: {
          application_events: boolean
          contact_request_events: boolean
          contract_events: boolean
          created_at: string
          email_enabled: boolean
          id: string
          in_app_enabled: boolean
          recruiter_status_events: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          application_events?: boolean
          contact_request_events?: boolean
          contract_events?: boolean
          created_at?: string
          email_enabled?: boolean
          id?: string
          in_app_enabled?: boolean
          recruiter_status_events?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          application_events?: boolean
          contact_request_events?: boolean
          contract_events?: boolean
          created_at?: string
          email_enabled?: boolean
          id?: string
          in_app_enabled?: boolean
          recruiter_status_events?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          payload: Json
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          payload?: Json
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          payload?: Json
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
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
      opportunities: {
        Row: {
          admin_review_status: string
          benefits: string | null
          company_name: string
          cpm: number | null
          created_at: string
          deadhead_paid: boolean | null
          description: string | null
          detention_pay: string | null
          driver_type: string | null
          equipment_year: string | null
          escrow_amount: number | null
          escrow_required: boolean
          estimated_deadhead_miles: number | null
          estimated_loaded_miles: number | null
          estimated_weekly_gross: number | null
          estimated_weekly_miles: number | null
          featured: boolean
          flat_weekly_pay: number | null
          forced_dispatch: boolean | null
          fuel_paid_by: string | null
          hiring_city: string | null
          hiring_state: string | null
          hiring_states: string[]
          home_time: string | null
          id: string
          insurance_deductions: number | null
          layover_pay: string | null
          lease_payment: number | null
          maintenance_deductions: number | null
          other_deductions: number | null
          pay_model: string | null
          percentage_pay: number | null
          pets_allowed: boolean | null
          published_at: string | null
          recruiter_id: string
          riders_allowed: boolean | null
          route_type: string | null
          sign_on_bonus: number | null
          status: string
          title: string
          trailer_type: string | null
          transparency_confirmed: boolean
          updated_at: string
          view_count: number
        }
        Insert: {
          admin_review_status?: string
          benefits?: string | null
          company_name: string
          cpm?: number | null
          created_at?: string
          deadhead_paid?: boolean | null
          description?: string | null
          detention_pay?: string | null
          driver_type?: string | null
          equipment_year?: string | null
          escrow_amount?: number | null
          escrow_required?: boolean
          estimated_deadhead_miles?: number | null
          estimated_loaded_miles?: number | null
          estimated_weekly_gross?: number | null
          estimated_weekly_miles?: number | null
          featured?: boolean
          flat_weekly_pay?: number | null
          forced_dispatch?: boolean | null
          fuel_paid_by?: string | null
          hiring_city?: string | null
          hiring_state?: string | null
          hiring_states?: string[]
          home_time?: string | null
          id?: string
          insurance_deductions?: number | null
          layover_pay?: string | null
          lease_payment?: number | null
          maintenance_deductions?: number | null
          other_deductions?: number | null
          pay_model?: string | null
          percentage_pay?: number | null
          pets_allowed?: boolean | null
          published_at?: string | null
          recruiter_id: string
          riders_allowed?: boolean | null
          route_type?: string | null
          sign_on_bonus?: number | null
          status?: string
          title: string
          trailer_type?: string | null
          transparency_confirmed?: boolean
          updated_at?: string
          view_count?: number
        }
        Update: {
          admin_review_status?: string
          benefits?: string | null
          company_name?: string
          cpm?: number | null
          created_at?: string
          deadhead_paid?: boolean | null
          description?: string | null
          detention_pay?: string | null
          driver_type?: string | null
          equipment_year?: string | null
          escrow_amount?: number | null
          escrow_required?: boolean
          estimated_deadhead_miles?: number | null
          estimated_loaded_miles?: number | null
          estimated_weekly_gross?: number | null
          estimated_weekly_miles?: number | null
          featured?: boolean
          flat_weekly_pay?: number | null
          forced_dispatch?: boolean | null
          fuel_paid_by?: string | null
          hiring_city?: string | null
          hiring_state?: string | null
          hiring_states?: string[]
          home_time?: string | null
          id?: string
          insurance_deductions?: number | null
          layover_pay?: string | null
          lease_payment?: number | null
          maintenance_deductions?: number | null
          other_deductions?: number | null
          pay_model?: string | null
          percentage_pay?: number | null
          pets_allowed?: boolean | null
          published_at?: string | null
          recruiter_id?: string
          riders_allowed?: boolean | null
          route_type?: string | null
          sign_on_bonus?: number | null
          status?: string
          title?: string
          trailer_type?: string | null
          transparency_confirmed?: boolean
          updated_at?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_recruiter_id_fkey"
            columns: ["recruiter_id"]
            isOneToOne: false
            referencedRelation: "recruiter_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_applications: {
        Row: {
          application_type: string
          created_at: string
          driver_email_snapshot: string | null
          driver_phone_snapshot: string | null
          driver_profile_id: string | null
          driver_user_id: string
          id: string
          message: string | null
          opportunity_id: string
          preferred_contact_method: string | null
          recruiter_id: string
          status: string
          updated_at: string
        }
        Insert: {
          application_type?: string
          created_at?: string
          driver_email_snapshot?: string | null
          driver_phone_snapshot?: string | null
          driver_profile_id?: string | null
          driver_user_id: string
          id?: string
          message?: string | null
          opportunity_id: string
          preferred_contact_method?: string | null
          recruiter_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          application_type?: string
          created_at?: string
          driver_email_snapshot?: string | null
          driver_phone_snapshot?: string | null
          driver_profile_id?: string | null
          driver_user_id?: string
          id?: string
          message?: string | null
          opportunity_id?: string
          preferred_contact_method?: string | null
          recruiter_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_applications_driver_profile_id_fkey"
            columns: ["driver_profile_id"]
            isOneToOne: false
            referencedRelation: "driver_opportunity_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_applications_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_applications_recruiter_id_fkey"
            columns: ["recruiter_id"]
            isOneToOne: false
            referencedRelation: "recruiter_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_reports: {
        Row: {
          admin_notes: string | null
          created_at: string
          details: string | null
          id: string
          opportunity_id: string | null
          reason: string
          recruiter_id: string | null
          reporter_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          details?: string | null
          id?: string
          opportunity_id?: string | null
          reason: string
          recruiter_id?: string | null
          reporter_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          details?: string | null
          id?: string
          opportunity_id?: string | null
          reason?: string
          recruiter_id?: string | null
          reporter_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_reports_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_reports_recruiter_id_fkey"
            columns: ["recruiter_id"]
            isOneToOne: false
            referencedRelation: "recruiter_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parking_favorites: {
        Row: {
          created_at: string
          id: string
          parking_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          parking_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          parking_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parking_favorites_parking_id_fkey"
            columns: ["parking_id"]
            isOneToOne: false
            referencedRelation: "parking_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      parking_locations: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          id: string
          is_paid: boolean
          latitude: number
          longitude: number
          name: string
          overnight_allowed: boolean
          total_spots: number | null
          truck_friendly: boolean
          type: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_paid?: boolean
          latitude: number
          longitude: number
          name: string
          overnight_allowed?: boolean
          total_spots?: number | null
          truck_friendly?: boolean
          type?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_paid?: boolean
          latitude?: number
          longitude?: number
          name?: string
          overnight_allowed?: boolean
          total_spots?: number | null
          truck_friendly?: boolean
          type?: string
        }
        Relationships: []
      }
      parking_reports: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          parking_id: string
          report_hour_bucket: string
          safety_rating: number | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          parking_id: string
          report_hour_bucket: string
          safety_rating?: number | null
          status: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          parking_id?: string
          report_hour_bucket?: string
          safety_rating?: number | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parking_reports_parking_id_fkey"
            columns: ["parking_id"]
            isOneToOne: false
            referencedRelation: "parking_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      parking_verifications: {
        Row: {
          created_at: string
          id: string
          parking_id: string
          user_id: string
          verification_hour_bucket: string
          verified_status: string
        }
        Insert: {
          created_at?: string
          id?: string
          parking_id: string
          user_id: string
          verification_hour_bucket?: string
          verified_status: string
        }
        Update: {
          created_at?: string
          id?: string
          parking_id?: string
          user_id?: string
          verification_hour_bucket?: string
          verified_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "parking_verifications_parking_id_fkey"
            columns: ["parking_id"]
            isOneToOne: false
            referencedRelation: "parking_locations"
            referencedColumns: ["id"]
          },
        ]
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
          driver_handle: string | null
          handle_emoji: string | null
          handle_public: boolean
          id: string
          last_seen_release_id: string | null
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
          driver_handle?: string | null
          handle_emoji?: string | null
          handle_public?: boolean
          id?: string
          last_seen_release_id?: string | null
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
          driver_handle?: string | null
          handle_emoji?: string | null
          handle_public?: boolean
          id?: string
          last_seen_release_id?: string | null
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
      recruiter_billing_profiles: {
        Row: {
          active_opportunity_limit: number
          created_at: string
          current_period_end: string | null
          id: string
          plan: string
          recruiter_id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active_opportunity_limit?: number
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan?: string
          recruiter_id: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active_opportunity_limit?: number
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan?: string
          recruiter_id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruiter_billing_profiles_recruiter_id_fkey"
            columns: ["recruiter_id"]
            isOneToOne: false
            referencedRelation: "recruiter_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recruiter_contact_requests: {
        Row: {
          application_id: string
          created_at: string
          driver_note: string | null
          driver_user_id: string
          id: string
          recruiter_note: string | null
          recruiter_user_id: string
          responded_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          application_id: string
          created_at?: string
          driver_note?: string | null
          driver_user_id: string
          id?: string
          recruiter_note?: string | null
          recruiter_user_id: string
          responded_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          driver_note?: string | null
          driver_user_id?: string
          id?: string
          recruiter_note?: string | null
          recruiter_user_id?: string
          responded_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruiter_contact_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "opportunity_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      recruiter_profiles: {
        Row: {
          admin_notes: string | null
          company_address: string | null
          company_city: string | null
          company_name: string
          company_phone: string | null
          company_state: string | null
          company_website: string | null
          created_at: string
          dot_number: string | null
          driver_types_hired: string[]
          equipment_types: string[]
          hiring_states: string[]
          id: string
          mc_number: string | null
          recruiter_email: string | null
          recruiter_name: string
          recruiter_phone: string | null
          status: string
          updated_at: string
          user_id: string
          verification_status: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          admin_notes?: string | null
          company_address?: string | null
          company_city?: string | null
          company_name: string
          company_phone?: string | null
          company_state?: string | null
          company_website?: string | null
          created_at?: string
          dot_number?: string | null
          driver_types_hired?: string[]
          equipment_types?: string[]
          hiring_states?: string[]
          id?: string
          mc_number?: string | null
          recruiter_email?: string | null
          recruiter_name: string
          recruiter_phone?: string | null
          status?: string
          updated_at?: string
          user_id: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          admin_notes?: string | null
          company_address?: string | null
          company_city?: string | null
          company_name?: string
          company_phone?: string | null
          company_state?: string | null
          company_website?: string | null
          created_at?: string
          dot_number?: string | null
          driver_types_hired?: string[]
          equipment_types?: string[]
          hiring_states?: string[]
          id?: string
          mc_number?: string | null
          recruiter_email?: string | null
          recruiter_name?: string
          recruiter_phone?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
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
      saved_opportunities: {
        Row: {
          created_at: string
          id: string
          opportunity_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          opportunity_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          opportunity_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_opportunities_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
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
          default_dh_pay_rate: number | null
          default_dh_pay_status: string
          default_other_fees: number | null
          default_pay_model: string | null
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
          default_dh_pay_rate?: number | null
          default_dh_pay_status?: string
          default_other_fees?: number | null
          default_pay_model?: string | null
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
          default_dh_pay_rate?: number | null
          default_dh_pay_status?: string
          default_other_fees?: number | null
          default_pay_model?: string | null
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
      award_points: {
        Args: { _amount: number; _category: string; _user_id: string }
        Returns: {
          best_weekly_period_start: string | null
          best_weekly_points: number
          last_activity_date: string | null
          load_points: number
          parking_points: number
          streak_days: number
          total_points: number
          updated_at: string
          user_id: string
          weekly_period_start: string | null
          weekly_points: number
        }
        SetofOptions: {
          from: "*"
          to: "driver_points"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      build_lane_key: {
        Args: { _dropoff: string; _pickup: string }
        Returns: string
      }
      create_notification: {
        Args: {
          _body: string
          _payload?: Json
          _title: string
          _type: string
          _user_id: string
        }
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
      expire_stale_contact_requests: { Args: never; Returns: number }
      get_weekly_driver_leaderboard: {
        Args: { _limit?: number }
        Returns: {
          load_points: number
          masked_display_name: string
          parking_points: number
          rank: number
          streak_days: number
          tier: string
          total_points: number
          user_id: string
          weekly_points: number
        }[]
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_application_party: {
        Args: { _application_id: string; _user_id: string }
        Returns: boolean
      }
      is_recruiter_owner: {
        Args: { _recruiter_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      mark_all_notifications_read: { Args: never; Returns: number }
      mark_notification_read: {
        Args: { notification_id: string }
        Returns: undefined
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      notification_category: { Args: { _type: string }; Returns: string }
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
      record_driver_application_response: {
        Args: { application_id: string; note?: string; response_type: string }
        Returns: string
      }
      recruiter_has_priority_plan: {
        Args: { _recruiter_id: string }
        Returns: boolean
      }
      recruiter_plan_limit: { Args: { _plan: string }; Returns: number }
      request_driver_contact: {
        Args: { application_id: string; recruiter_note?: string }
        Returns: string
      }
      respond_to_contact_request: {
        Args: { decision: string; driver_note?: string; request_id: string }
        Returns: undefined
      }
      resubmit_recruiter_profile: {
        Args: { profile_id: string }
        Returns: undefined
      }
      submit_lead_magnet_signup: {
        Args: {
          _bundle_name?: string
          _bundle_version?: string
          _converted_user_id?: string
          _email: string
          _first_name?: string
          _source_page?: string
          _utm_campaign?: string
          _utm_content?: string
          _utm_medium?: string
          _utm_source?: string
          _utm_term?: string
        }
        Returns: string
      }
      withdraw_opportunity_application: {
        Args: { application_id: string }
        Returns: undefined
      }
    }
    Enums: {
      contract_status:
        | "uploaded"
        | "parsing"
        | "parsed"
        | "ai_reviewed"
        | "driver_reviewing"
        | "changes_requested"
        | "rejected"
        | "approved"
        | "signed"
        | "expired"
        | "archived"
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
    Enums: {
      contract_status: [
        "uploaded",
        "parsing",
        "parsed",
        "ai_reviewed",
        "driver_reviewing",
        "changes_requested",
        "rejected",
        "approved",
        "signed",
        "expired",
        "archived",
      ],
    },
  },
} as const
