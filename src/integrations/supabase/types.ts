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
      agency_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          agency_id: string
          created_at: string
          driver_user_id: string | null
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          agency_id: string
          created_at?: string
          driver_user_id?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          agency_id?: string
          created_at?: string
          driver_user_id?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agency_audit_log_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_client_requests: {
        Row: {
          agency_id: string
          assigned_member_user_id: string | null
          created_at: string
          decided_at: string | null
          decided_by_user_id: string | null
          driver_user_id: string
          id: string
          message: string | null
          phone: string | null
          preferred_contact_method: string | null
          requested_permissions: Json
          selected_package_id: string | null
          status: Database["public"]["Enums"]["agency_client_request_status"]
          updated_at: string
        }
        Insert: {
          agency_id: string
          assigned_member_user_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_user_id?: string | null
          driver_user_id: string
          id?: string
          message?: string | null
          phone?: string | null
          preferred_contact_method?: string | null
          requested_permissions?: Json
          selected_package_id?: string | null
          status?: Database["public"]["Enums"]["agency_client_request_status"]
          updated_at?: string
        }
        Update: {
          agency_id?: string
          assigned_member_user_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_user_id?: string | null
          driver_user_id?: string
          id?: string
          message?: string | null
          phone?: string | null
          preferred_contact_method?: string | null
          requested_permissions?: Json
          selected_package_id?: string | null
          status?: Database["public"]["Enums"]["agency_client_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_client_requests_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_client_requests_selected_package_id_fkey"
            columns: ["selected_package_id"]
            isOneToOne: false
            referencedRelation: "agency_service_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_delegation_requests: {
        Row: {
          agency_id: string
          client_request_id: string | null
          created_at: string
          created_by_user_id: string
          decided_at: string | null
          driver_user_id: string
          id: string
          member_invite_email: string
          member_user_id: string
          requested_permissions: Json
          status: Database["public"]["Enums"]["agency_delegation_status"]
          updated_at: string
        }
        Insert: {
          agency_id: string
          client_request_id?: string | null
          created_at?: string
          created_by_user_id: string
          decided_at?: string | null
          driver_user_id: string
          id?: string
          member_invite_email: string
          member_user_id: string
          requested_permissions?: Json
          status?: Database["public"]["Enums"]["agency_delegation_status"]
          updated_at?: string
        }
        Update: {
          agency_id?: string
          client_request_id?: string | null
          created_at?: string
          created_by_user_id?: string
          decided_at?: string | null
          driver_user_id?: string
          id?: string
          member_invite_email?: string
          member_user_id?: string
          requested_permissions?: Json
          status?: Database["public"]["Enums"]["agency_delegation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_delegation_requests_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_delegation_requests_client_request_id_fkey"
            columns: ["client_request_id"]
            isOneToOne: false
            referencedRelation: "agency_client_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_entitlements: {
        Row: {
          active_client_limit: number | null
          agency_id: string
          created_at: string
          current_period_end: string | null
          id: string
          member_limit: number | null
          plan_key: string
          service_package_limit: number | null
          source: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          active_client_limit?: number | null
          agency_id: string
          created_at?: string
          current_period_end?: string | null
          id?: string
          member_limit?: number | null
          plan_key?: string
          service_package_limit?: number | null
          source?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          active_client_limit?: number | null
          agency_id?: string
          created_at?: string
          current_period_end?: string | null
          id?: string
          member_limit?: number | null
          plan_key?: string
          service_package_limit?: number | null
          source?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_entitlements_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: true
            referencedRelation: "agency_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_members: {
        Row: {
          accepted_at: string | null
          agency_id: string
          created_at: string
          id: string
          invite_email: string
          invite_token_hash: string | null
          invited_at: string
          member_user_id: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["agency_member_role"]
          status: Database["public"]["Enums"]["agency_member_status"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          agency_id: string
          created_at?: string
          id?: string
          invite_email: string
          invite_token_hash?: string | null
          invited_at?: string
          member_user_id?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["agency_member_role"]
          status?: Database["public"]["Enums"]["agency_member_status"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          agency_id?: string
          created_at?: string
          id?: string
          invite_email?: string
          invite_token_hash?: string | null
          invited_at?: string
          member_user_id?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["agency_member_role"]
          status?: Database["public"]["Enums"]["agency_member_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_members_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_profiles: {
        Row: {
          contact_email: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          owner_user_id: string
          slug: string | null
          status: Database["public"]["Enums"]["agency_status"]
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_user_id: string
          slug?: string | null
          status?: Database["public"]["Enums"]["agency_status"]
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_user_id?: string
          slug?: string | null
          status?: Database["public"]["Enums"]["agency_status"]
          updated_at?: string
        }
        Relationships: []
      }
      agency_service_packages: {
        Row: {
          agency_id: string
          billing_frequency_display_text: string | null
          created_at: string
          description: string | null
          id: string
          included_services: Json
          is_active: boolean
          name: string
          price_display_text: string | null
          recommended_permissions: Json
          sort_order: number
          updated_at: string
        }
        Insert: {
          agency_id: string
          billing_frequency_display_text?: string | null
          created_at?: string
          description?: string | null
          id?: string
          included_services?: Json
          is_active?: boolean
          name: string
          price_display_text?: string | null
          recommended_permissions?: Json
          sort_order?: number
          updated_at?: string
        }
        Update: {
          agency_id?: string
          billing_frequency_display_text?: string | null
          created_at?: string
          description?: string | null
          id?: string
          included_services?: Json
          is_active?: boolean
          name?: string
          price_display_text?: string | null
          recommended_permissions?: Json
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_service_packages_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_work_items: {
        Row: {
          agency_id: string
          assigned_member_user_id: string | null
          client_request_id: string | null
          completed_at: string | null
          created_at: string
          created_by_user_id: string
          description: string | null
          driver_user_id: string
          due_date: string | null
          id: string
          last_driver_response: string | null
          last_driver_response_at: string | null
          priority: Database["public"]["Enums"]["agency_work_item_priority"]
          status: Database["public"]["Enums"]["agency_work_item_status"]
          title: string
          type: Database["public"]["Enums"]["agency_work_item_type"]
          updated_at: string
        }
        Insert: {
          agency_id: string
          assigned_member_user_id?: string | null
          client_request_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_user_id: string
          description?: string | null
          driver_user_id: string
          due_date?: string | null
          id?: string
          last_driver_response?: string | null
          last_driver_response_at?: string | null
          priority?: Database["public"]["Enums"]["agency_work_item_priority"]
          status?: Database["public"]["Enums"]["agency_work_item_status"]
          title: string
          type?: Database["public"]["Enums"]["agency_work_item_type"]
          updated_at?: string
        }
        Update: {
          agency_id?: string
          assigned_member_user_id?: string | null
          client_request_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_user_id?: string
          description?: string | null
          driver_user_id?: string
          due_date?: string | null
          id?: string
          last_driver_response?: string | null
          last_driver_response_at?: string | null
          priority?: Database["public"]["Enums"]["agency_work_item_priority"]
          status?: Database["public"]["Enums"]["agency_work_item_status"]
          title?: string
          type?: Database["public"]["Enums"]["agency_work_item_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_work_items_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_work_items_client_request_id_fkey"
            columns: ["client_request_id"]
            isOneToOne: false
            referencedRelation: "agency_client_requests"
            referencedColumns: ["id"]
          },
        ]
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
      assistant_audit_log: {
        Row: {
          action: string
          assistant_user_id: string
          created_at: string
          delegate_id: string
          driver_user_id: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          assistant_user_id: string
          created_at?: string
          delegate_id: string
          driver_user_id: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          assistant_user_id?: string
          created_at?: string
          delegate_id?: string
          driver_user_id?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "assistant_audit_log_delegate_id_fkey"
            columns: ["delegate_id"]
            isOneToOne: false
            referencedRelation: "driver_assistants"
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
      business_checkout_claims: {
        Row: {
          checkout_expires_at: string | null
          claim_token: string | null
          context: string
          created_at: string
          generation: number
          last_error_code: string | null
          lease_expires_at: string | null
          plan_key: string
          request_key: string
          state: string
          stripe_checkout_session_id: string | null
          subject_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          checkout_expires_at?: string | null
          claim_token?: string | null
          context: string
          created_at?: string
          generation?: number
          last_error_code?: string | null
          lease_expires_at?: string | null
          plan_key: string
          request_key: string
          state: string
          stripe_checkout_session_id?: string | null
          subject_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          checkout_expires_at?: string | null
          claim_token?: string | null
          context?: string
          created_at?: string
          generation?: number
          last_error_code?: string | null
          lease_expires_at?: string | null
          plan_key?: string
          request_key?: string
          state?: string
          stripe_checkout_session_id?: string | null
          subject_id?: string
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
      driver_assistants: {
        Row: {
          accepted_at: string | null
          agency_delegation_id: string | null
          assistant_user_id: string | null
          created_at: string
          driver_user_id: string
          id: string
          invite_email: string
          invite_token_hash: string | null
          invited_at: string
          last_active_at: string | null
          permissions: Json
          revoked_at: string | null
          status: Database["public"]["Enums"]["assistant_status"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          agency_delegation_id?: string | null
          assistant_user_id?: string | null
          created_at?: string
          driver_user_id: string
          id?: string
          invite_email: string
          invite_token_hash?: string | null
          invited_at?: string
          last_active_at?: string | null
          permissions?: Json
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["assistant_status"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          agency_delegation_id?: string | null
          assistant_user_id?: string | null
          created_at?: string
          driver_user_id?: string
          id?: string
          invite_email?: string
          invite_token_hash?: string | null
          invited_at?: string
          last_active_at?: string | null
          permissions?: Json
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["assistant_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_assistants_agency_delegation_id_fkey"
            columns: ["agency_delegation_id"]
            isOneToOne: false
            referencedRelation: "agency_delegation_requests"
            referencedColumns: ["id"]
          },
        ]
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
      driver_point_events: {
        Row: {
          amount: number
          category: string
          created_at: string
          id: string
          source_id: string
          source_type: string
          user_id: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          id?: string
          source_id: string
          source_type: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          id?: string
          source_id?: string
          source_type?: string
          user_id?: string
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
      driver_referrals: {
        Row: {
          created_at: string
          id: string
          last_status_at: string
          opportunity_id: string
          recruiter_id: string
          referred_driver_email: string | null
          referred_driver_name: string | null
          referred_driver_note: string | null
          referred_driver_phone: string | null
          referred_driver_user_id: string | null
          referring_driver_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_status_at?: string
          opportunity_id: string
          recruiter_id: string
          referred_driver_email?: string | null
          referred_driver_name?: string | null
          referred_driver_note?: string | null
          referred_driver_phone?: string | null
          referred_driver_user_id?: string | null
          referring_driver_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_status_at?: string
          opportunity_id?: string
          recruiter_id?: string
          referred_driver_email?: string | null
          referred_driver_name?: string | null
          referred_driver_note?: string | null
          referred_driver_phone?: string | null
          referred_driver_user_id?: string | null
          referring_driver_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_referrals_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_referrals_recruiter_id_fkey"
            columns: ["recruiter_id"]
            isOneToOne: false
            referencedRelation: "recruiter_profiles"
            referencedColumns: ["id"]
          },
        ]
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
          assistant_delegate_id: string | null
          category: string
          created_at: string
          created_by_user_id: string | null
          expense_date: string
          expense_type: string
          gallons: number | null
          id: string
          linked_load_id: string | null
          notes: string | null
          updated_at: string
          updated_by_user_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          assistant_delegate_id?: string | null
          category: string
          created_at?: string
          created_by_user_id?: string | null
          expense_date: string
          expense_type?: string
          gallons?: number | null
          id?: string
          linked_load_id?: string | null
          notes?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          assistant_delegate_id?: string | null
          category?: string
          created_at?: string
          created_by_user_id?: string | null
          expense_date?: string
          expense_type?: string
          gallons?: number | null
          id?: string
          linked_load_id?: string | null
          notes?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_assistant_delegate_id_fkey"
            columns: ["assistant_delegate_id"]
            isOneToOne: false
            referencedRelation: "driver_assistants"
            referencedColumns: ["id"]
          },
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
          assistant_delegate_id: string | null
          created_at: string
          created_by_user_id: string | null
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
          updated_by_user_id: string | null
          user_id: string
        }
        Insert: {
          assistant_delegate_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
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
          updated_by_user_id?: string | null
          user_id: string
        }
        Update: {
          assistant_delegate_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
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
          updated_by_user_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuel_logs_assistant_delegate_id_fkey"
            columns: ["assistant_delegate_id"]
            isOneToOne: false
            referencedRelation: "driver_assistants"
            referencedColumns: ["id"]
          },
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
          assistant_delegate_id: string | null
          created_at: string
          created_by_user_id: string | null
          detention_minutes: number | null
          id: string
          load_id: string
          location: string
          stop_date: string | null
          stop_order: number
          stop_type: string
          updated_at: string
          updated_by_user_id: string | null
          user_id: string
        }
        Insert: {
          assistant_delegate_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          detention_minutes?: number | null
          id?: string
          load_id: string
          location: string
          stop_date?: string | null
          stop_order: number
          stop_type?: string
          updated_at?: string
          updated_by_user_id?: string | null
          user_id: string
        }
        Update: {
          assistant_delegate_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          detention_minutes?: number | null
          id?: string
          load_id?: string
          location?: string
          stop_date?: string | null
          stop_order?: number
          stop_type?: string
          updated_at?: string
          updated_by_user_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "load_stops_assistant_delegate_id_fkey"
            columns: ["assistant_delegate_id"]
            isOneToOne: false
            referencedRelation: "driver_assistants"
            referencedColumns: ["id"]
          },
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
          assistant_delegate_id: string | null
          broker_id: string | null
          broker_name_raw: string | null
          created_at: string
          created_by_user_id: string | null
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
          updated_by_user_id: string | null
          user_id: string
          wait_fee: number
        }
        Insert: {
          actual_pay_received?: number | null
          assistant_delegate_id?: string | null
          broker_id?: string | null
          broker_name_raw?: string | null
          created_at?: string
          created_by_user_id?: string | null
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
          updated_by_user_id?: string | null
          user_id: string
          wait_fee?: number
        }
        Update: {
          actual_pay_received?: number | null
          assistant_delegate_id?: string | null
          broker_id?: string | null
          broker_name_raw?: string | null
          created_at?: string
          created_by_user_id?: string | null
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
          updated_by_user_id?: string | null
          user_id?: string
          wait_fee?: number
        }
        Relationships: [
          {
            foreignKeyName: "loads_assistant_delegate_id_fkey"
            columns: ["assistant_delegate_id"]
            isOneToOne: false
            referencedRelation: "driver_assistants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_user_restrictions: {
        Row: {
          admin_note: string | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          reason_code: string | null
          restriction: string
          scope: string
          starts_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          reason_code?: string | null
          restriction: string
          scope: string
          starts_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          reason_code?: string | null
          restriction?: string
          scope?: string
          starts_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          agency_events: boolean
          application_events: boolean
          assistant_events: boolean
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
          agency_events?: boolean
          application_events?: boolean
          assistant_events?: boolean
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
          agency_events?: boolean
          application_events?: boolean
          assistant_events?: boolean
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
          actual_benefits: string | null
          admin_review_status: string
          benefits: string | null
          canonical_version: number | null
          company_name: string
          cpm: number | null
          created_at: string
          deadhead_paid: boolean | null
          description: string | null
          detention_pay: string | null
          driver_type: string | null
          employment_model: string | null
          equipment_year: string | null
          escrow_amount: number | null
          escrow_amount_frequency: string | null
          escrow_required: boolean
          escrow_required_state: string | null
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
          insurance_deduction_frequency: string | null
          insurance_deductions: number | null
          layover_pay: string | null
          lease_payment: number | null
          lease_payment_frequency: string | null
          maintenance_deduction_frequency: string | null
          maintenance_deductions: number | null
          mixed_pay_components: Json
          other_deduction_frequency: string | null
          other_deductions: number | null
          other_pay_method_label: string | null
          other_weekly_gross: number | null
          pay_model: string | null
          percentage_basis_label: string | null
          percentage_pay: number | null
          percentage_weekly_revenue_basis: number | null
          pets_allowed: boolean | null
          published_at: string | null
          recruiter_id: string
          requirements: string | null
          riders_allowed: boolean | null
          route_type: string | null
          salary_amount: number | null
          salary_frequency: string | null
          sign_on_bonus: number | null
          status: string
          team_configuration: string | null
          title: string
          trailer_type: string | null
          transparency_confirmed: boolean
          typical_lanes: string | null
          updated_at: string
          view_count: number
        }
        Insert: {
          actual_benefits?: string | null
          admin_review_status?: string
          benefits?: string | null
          canonical_version?: number | null
          company_name: string
          cpm?: number | null
          created_at?: string
          deadhead_paid?: boolean | null
          description?: string | null
          detention_pay?: string | null
          driver_type?: string | null
          employment_model?: string | null
          equipment_year?: string | null
          escrow_amount?: number | null
          escrow_amount_frequency?: string | null
          escrow_required?: boolean
          escrow_required_state?: string | null
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
          insurance_deduction_frequency?: string | null
          insurance_deductions?: number | null
          layover_pay?: string | null
          lease_payment?: number | null
          lease_payment_frequency?: string | null
          maintenance_deduction_frequency?: string | null
          maintenance_deductions?: number | null
          mixed_pay_components?: Json
          other_deduction_frequency?: string | null
          other_deductions?: number | null
          other_pay_method_label?: string | null
          other_weekly_gross?: number | null
          pay_model?: string | null
          percentage_basis_label?: string | null
          percentage_pay?: number | null
          percentage_weekly_revenue_basis?: number | null
          pets_allowed?: boolean | null
          published_at?: string | null
          recruiter_id: string
          requirements?: string | null
          riders_allowed?: boolean | null
          route_type?: string | null
          salary_amount?: number | null
          salary_frequency?: string | null
          sign_on_bonus?: number | null
          status?: string
          team_configuration?: string | null
          title: string
          trailer_type?: string | null
          transparency_confirmed?: boolean
          typical_lanes?: string | null
          updated_at?: string
          view_count?: number
        }
        Update: {
          actual_benefits?: string | null
          admin_review_status?: string
          benefits?: string | null
          canonical_version?: number | null
          company_name?: string
          cpm?: number | null
          created_at?: string
          deadhead_paid?: boolean | null
          description?: string | null
          detention_pay?: string | null
          driver_type?: string | null
          employment_model?: string | null
          equipment_year?: string | null
          escrow_amount?: number | null
          escrow_amount_frequency?: string | null
          escrow_required?: boolean
          escrow_required_state?: string | null
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
          insurance_deduction_frequency?: string | null
          insurance_deductions?: number | null
          layover_pay?: string | null
          lease_payment?: number | null
          lease_payment_frequency?: string | null
          maintenance_deduction_frequency?: string | null
          maintenance_deductions?: number | null
          mixed_pay_components?: Json
          other_deduction_frequency?: string | null
          other_deductions?: number | null
          other_pay_method_label?: string | null
          other_weekly_gross?: number | null
          pay_model?: string | null
          percentage_basis_label?: string | null
          percentage_pay?: number | null
          percentage_weekly_revenue_basis?: number | null
          pets_allowed?: boolean | null
          published_at?: string | null
          recruiter_id?: string
          requirements?: string | null
          riders_allowed?: boolean | null
          route_type?: string | null
          salary_amount?: number | null
          salary_frequency?: string | null
          sign_on_bonus?: number | null
          status?: string
          team_configuration?: string | null
          title?: string
          trailer_type?: string | null
          transparency_confirmed?: boolean
          typical_lanes?: string | null
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
          contact_sharing_consent: boolean
          contact_sharing_consent_at: string | null
          created_at: string
          driver_email_snapshot: string | null
          driver_phone_snapshot: string | null
          driver_profile_id: string | null
          driver_user_id: string
          id: string
          idempotency_key: string | null
          is_legacy: boolean
          message: string | null
          opportunity_id: string
          preferred_contact_method: string | null
          recruiter_id: string
          snapshot_version: number
          status: string
          submission_snapshot: Json
          submitted_at: string | null
          updated_at: string
          withdrawn_at: string | null
        }
        Insert: {
          application_type?: string
          contact_sharing_consent?: boolean
          contact_sharing_consent_at?: string | null
          created_at?: string
          driver_email_snapshot?: string | null
          driver_phone_snapshot?: string | null
          driver_profile_id?: string | null
          driver_user_id: string
          id?: string
          idempotency_key?: string | null
          is_legacy?: boolean
          message?: string | null
          opportunity_id: string
          preferred_contact_method?: string | null
          recruiter_id: string
          snapshot_version?: number
          status?: string
          submission_snapshot?: Json
          submitted_at?: string | null
          updated_at?: string
          withdrawn_at?: string | null
        }
        Update: {
          application_type?: string
          contact_sharing_consent?: boolean
          contact_sharing_consent_at?: string | null
          created_at?: string
          driver_email_snapshot?: string | null
          driver_phone_snapshot?: string | null
          driver_profile_id?: string | null
          driver_user_id?: string
          id?: string
          idempotency_key?: string | null
          is_legacy?: boolean
          message?: string | null
          opportunity_id?: string
          preferred_contact_method?: string | null
          recruiter_id?: string
          snapshot_version?: number
          status?: string
          submission_snapshot?: Json
          submitted_at?: string | null
          updated_at?: string
          withdrawn_at?: string | null
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
      opportunity_offers: {
        Row: {
          accepted_at: string | null
          application_id: string
          canceled_at: string | null
          contingencies: string | null
          created_at: string
          created_by: string | null
          declined_at: string | null
          driver_user_id: string
          equipment_summary: string | null
          estimated_weekly_amount: number | null
          expired_at: string | null
          expires_at: string | null
          home_time_terms: string | null
          id: string
          opportunity_id: string
          orientation_details: string | null
          pay_description: string | null
          proposed_start_date: string | null
          recruiter_id: string
          recruiter_message: string | null
          responded_at: string | null
          route_summary: string | null
          sent_at: string | null
          sent_snapshot: Json
          snapshot_version: number
          status: string
          superseded_at: string | null
          superseded_by: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          application_id: string
          canceled_at?: string | null
          contingencies?: string | null
          created_at?: string
          created_by?: string | null
          declined_at?: string | null
          driver_user_id: string
          equipment_summary?: string | null
          estimated_weekly_amount?: number | null
          expired_at?: string | null
          expires_at?: string | null
          home_time_terms?: string | null
          id?: string
          opportunity_id: string
          orientation_details?: string | null
          pay_description?: string | null
          proposed_start_date?: string | null
          recruiter_id: string
          recruiter_message?: string | null
          responded_at?: string | null
          route_summary?: string | null
          sent_at?: string | null
          sent_snapshot?: Json
          snapshot_version?: number
          status?: string
          superseded_at?: string | null
          superseded_by?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          application_id?: string
          canceled_at?: string | null
          contingencies?: string | null
          created_at?: string
          created_by?: string | null
          declined_at?: string | null
          driver_user_id?: string
          equipment_summary?: string | null
          estimated_weekly_amount?: number | null
          expired_at?: string | null
          expires_at?: string | null
          home_time_terms?: string | null
          id?: string
          opportunity_id?: string
          orientation_details?: string | null
          pay_description?: string | null
          proposed_start_date?: string | null
          recruiter_id?: string
          recruiter_message?: string | null
          responded_at?: string | null
          route_summary?: string | null
          sent_at?: string | null
          sent_snapshot?: Json
          snapshot_version?: number
          status?: string
          superseded_at?: string | null
          superseded_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_offers_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "opportunity_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_offers_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_offers_recruiter_id_fkey"
            columns: ["recruiter_id"]
            isOneToOne: false
            referencedRelation: "recruiter_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_offers_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "opportunity_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_publication_legacy_snapshot: {
        Row: {
          captured_at: string
          opportunity_ids: string[]
          snapshot_key: string
        }
        Insert: {
          captured_at?: string
          opportunity_ids: string[]
          snapshot_key: string
        }
        Update: {
          captured_at?: string
          opportunity_ids?: string[]
          snapshot_key?: string
        }
        Relationships: []
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
      professional_profiles: {
        Row: {
          availability: string
          bio: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          display_name: string
          professional_title: string | null
          service_areas: string[]
          services: string[]
          share_contact_details: boolean
          updated_at: string
          user_id: string
          visibility: string
          years_experience: number | null
        }
        Insert: {
          availability?: string
          bio?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          display_name: string
          professional_title?: string | null
          service_areas?: string[]
          services?: string[]
          share_contact_details?: boolean
          updated_at?: string
          user_id: string
          visibility?: string
          years_experience?: number | null
        }
        Update: {
          availability?: string
          bio?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          display_name?: string
          professional_title?: string | null
          service_areas?: string[]
          services?: string[]
          share_contact_details?: boolean
          updated_at?: string
          user_id?: string
          visibility?: string
          years_experience?: number | null
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
          intended_role: string
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
          intended_role?: string
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
          intended_role?: string
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
      recruiter_checkout_intents: {
        Row: {
          checkout_expires_at: string | null
          checkout_url: string | null
          claim_token: string | null
          created_at: string
          generation: number
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          plan: string
          recruiter_id: string
          state: string
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          checkout_expires_at?: string | null
          checkout_url?: string | null
          claim_token?: string | null
          created_at?: string
          generation?: number
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          plan: string
          recruiter_id: string
          state: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          checkout_expires_at?: string | null
          checkout_url?: string | null
          claim_token?: string | null
          created_at?: string
          generation?: number
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          plan?: string
          recruiter_id?: string
          state?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruiter_checkout_intents_recruiter_id_fkey"
            columns: ["recruiter_id"]
            isOneToOne: true
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
      recruiter_outreach_status: {
        Row: {
          admin_note: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          follow_up_at: string | null
          id: string
          last_contacted_at: string | null
          last_copied_at: string | null
          last_template_key: string | null
          last_template_label: string | null
          priority: string
          recruiter_profile_id: string
          recruiter_user_id: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          admin_note?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          follow_up_at?: string | null
          id?: string
          last_contacted_at?: string | null
          last_copied_at?: string | null
          last_template_key?: string | null
          last_template_label?: string | null
          priority?: string
          recruiter_profile_id: string
          recruiter_user_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          admin_note?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          follow_up_at?: string | null
          id?: string
          last_contacted_at?: string | null
          last_copied_at?: string | null
          last_template_key?: string | null
          last_template_label?: string | null
          priority?: string
          recruiter_profile_id?: string
          recruiter_user_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recruiter_outreach_status_recruiter_profile_id_fkey"
            columns: ["recruiter_profile_id"]
            isOneToOne: true
            referencedRelation: "recruiter_profiles"
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
          company_type: string | null
          company_website: string | null
          created_at: string
          dot_number: string | null
          driver_types_hired: string[]
          equipment_types: string[]
          hiring_states: string[]
          id: string
          legacy_terms_grandfathered_at: string | null
          mc_number: string | null
          posting_terms_accepted_at: string | null
          posting_terms_version: string | null
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
          company_type?: string | null
          company_website?: string | null
          created_at?: string
          dot_number?: string | null
          driver_types_hired?: string[]
          equipment_types?: string[]
          hiring_states?: string[]
          id?: string
          legacy_terms_grandfathered_at?: string | null
          mc_number?: string | null
          posting_terms_accepted_at?: string | null
          posting_terms_version?: string | null
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
          company_type?: string | null
          company_website?: string | null
          created_at?: string
          dot_number?: string | null
          driver_types_hired?: string[]
          equipment_types?: string[]
          hiring_states?: string[]
          id?: string
          legacy_terms_grandfathered_at?: string | null
          mc_number?: string | null
          posting_terms_accepted_at?: string | null
          posting_terms_version?: string | null
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
      recruiter_referral_settings: {
        Row: {
          bonus_amount: number | null
          bonus_terms: string | null
          created_at: string
          external_payment_disclaimer: string
          id: string
          payment_trigger: string | null
          recruiter_id: string
          referral_bonus_enabled: boolean
          updated_at: string
          waiting_period_days: number | null
        }
        Insert: {
          bonus_amount?: number | null
          bonus_terms?: string | null
          created_at?: string
          external_payment_disclaimer?: string
          id?: string
          payment_trigger?: string | null
          recruiter_id: string
          referral_bonus_enabled?: boolean
          updated_at?: string
          waiting_period_days?: number | null
        }
        Update: {
          bonus_amount?: number | null
          bonus_terms?: string | null
          created_at?: string
          external_payment_disclaimer?: string
          id?: string
          payment_trigger?: string | null
          recruiter_id?: string
          referral_bonus_enabled?: boolean
          updated_at?: string
          waiting_period_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recruiter_referral_settings_recruiter_id_fkey"
            columns: ["recruiter_id"]
            isOneToOne: true
            referencedRelation: "recruiter_profiles"
            referencedColumns: ["id"]
          },
        ]
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
      referral_status_events: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          created_at: string
          id: string
          new_status: string
          note: string | null
          old_status: string | null
          referral_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: string
          new_status: string
          note?: string | null
          old_status?: string | null
          referral_id: string
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: string
          new_status?: string
          note?: string | null
          old_status?: string | null
          referral_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_status_events_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "driver_referrals"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_articles: {
        Row: {
          ai_generation_prompt: string | null
          approval_status: string
          author_name: string | null
          content: string
          created_at: string
          created_by: string | null
          excerpt: string | null
          generated_by_ai: boolean
          id: string
          meta_description: string
          published_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          seo_title: string
          slug: string
          status: string
          title: string
          topic_cluster: string
          updated_at: string
        }
        Insert: {
          ai_generation_prompt?: string | null
          approval_status?: string
          author_name?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          excerpt?: string | null
          generated_by_ai?: boolean
          id?: string
          meta_description?: string
          published_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          seo_title?: string
          slug: string
          status?: string
          title: string
          topic_cluster?: string
          updated_at?: string
        }
        Update: {
          ai_generation_prompt?: string | null
          approval_status?: string
          author_name?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          excerpt?: string | null
          generated_by_ai?: boolean
          id?: string
          meta_description?: string
          published_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          seo_title?: string
          slug?: string
          status?: string
          title?: string
          topic_cluster?: string
          updated_at?: string
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
      stripe_webhook_events: {
        Row: {
          attempt_count: number
          claim_token: string | null
          event_type: string
          id: string
          last_error_code: string | null
          last_failed_at: string | null
          lease_expires_at: string | null
          processed_at: string | null
          processing_started_at: string | null
          processing_status: string
          result_code: string | null
          stripe_event_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          claim_token?: string | null
          event_type: string
          id?: string
          last_error_code?: string | null
          last_failed_at?: string | null
          lease_expires_at?: string | null
          processed_at?: string | null
          processing_started_at?: string | null
          processing_status: string
          result_code?: string | null
          stripe_event_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          claim_token?: string | null
          event_type?: string
          id?: string
          last_error_code?: string | null
          last_failed_at?: string | null
          lease_expires_at?: string | null
          processed_at?: string | null
          processing_started_at?: string | null
          processing_status?: string
          result_code?: string | null
          stripe_event_id?: string
          updated_at?: string
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
      user_capabilities: {
        Row: {
          activated_at: string | null
          capability: Database["public"]["Enums"]["user_capability_type"]
          created_at: string
          status: Database["public"]["Enums"]["user_capability_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          capability: Database["public"]["Enums"]["user_capability_type"]
          created_at?: string
          status: Database["public"]["Enums"]["user_capability_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          capability?: Database["public"]["Enums"]["user_capability_type"]
          created_at?: string
          status?: Database["public"]["Enums"]["user_capability_status"]
          updated_at?: string
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
      parking_reports_public: {
        Row: {
          created_at: string | null
          id: string | null
          notes: string | null
          parking_id: string | null
          report_hour_bucket: string | null
          safety_rating: number | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          notes?: string | null
          parking_id?: string | null
          report_hour_bucket?: string | null
          safety_rating?: number | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          notes?: string | null
          parking_id?: string | null
          report_hour_bucket?: string | null
          safety_rating?: number | null
          status?: string | null
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
      parking_verifications_public: {
        Row: {
          created_at: string | null
          id: string | null
          parking_id: string | null
          verification_hour_bucket: string | null
          verified_status: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          parking_id?: string | null
          verification_hour_bucket?: string | null
          verified_status?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          parking_id?: string | null
          verification_hour_bucket?: string | null
          verified_status?: string | null
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
    }
    Functions: {
      _agency_plan_defaults: {
        Args: { _plan_key: string }
        Returns: {
          active_client_limit: number
          member_limit: number
          service_package_limit: number
        }[]
      }
      _agency_plan_label: { Args: { _plan_key: string }; Returns: string }
      _derive_recruiter_capability_status: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["user_capability_status"]
      }
      _opportunity_jsonb_number: { Args: { j: Json }; Returns: number }
      _opportunity_numeric_is_finite: { Args: { v: number }; Returns: boolean }
      _professional_profile_normalize_string_array: {
        Args: {
          _input: string[]
          _label: string
          _max_elems: number
          _max_len: number
        }
        Returns: string[]
      }
      _professional_profile_relationship_authorized: {
        Args: { _target: string; _viewer: string }
        Returns: boolean
      }
      _professional_profile_string_array_is_canonical: {
        Args: { _input: string[]; _max_elems: number; _max_len: number }
        Returns: boolean
      }
      _sync_recruiter_capability: {
        Args: { _user_id: string }
        Returns: undefined
      }
      accept_agency_invite: {
        Args: { _token: string }
        Returns: {
          accepted_at: string | null
          agency_id: string
          created_at: string
          id: string
          invite_email: string
          invite_token_hash: string | null
          invited_at: string
          member_user_id: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["agency_member_role"]
          status: Database["public"]["Enums"]["agency_member_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agency_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      accept_assistant_invite: { Args: { _token: string }; Returns: Json }
      accept_recruiter_posting_terms: {
        Args: { _version: string }
        Returns: string
      }
      apply_recruiter_intent: { Args: never; Returns: Json }
      assert_agency_limit: {
        Args: { _action: string; _agency_id: string }
        Returns: undefined
      }
      assistant_delete_load_stops: {
        Args: { _driver: string; _load_id: string }
        Returns: number
      }
      assistant_has_permission: {
        Args: { _assistant: string; _driver: string; _perm: string }
        Returns: boolean
      }
      award_load_points: {
        Args: { _load_id: string }
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
      award_parking_report_points: {
        Args: { _report_id: string }
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
      award_parking_verification_points: {
        Args: { _verification_id: string }
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
      begin_recruiter_setup: {
        Args: never
        Returns: Database["public"]["Enums"]["user_capability_status"]
      }
      bind_recruiter_checkout_customer: {
        Args: { _claim_token: string; _customer_id: string; _intent_id: string }
        Returns: {
          outcome: string
          reason: string
        }[]
      }
      build_application_submission_snapshot: {
        Args: {
          _attestations?: Json
          _driver_user_id: string
          _opportunity_id: string
        }
        Returns: Json
      }
      build_lane_key: {
        Args: { _dropoff: string; _pickup: string }
        Returns: string
      }
      claim_business_checkout: {
        Args: {
          _context: string
          _plan_key: string
          _request_key: string
          _subject_id: string
          _user_id: string
        }
        Returns: {
          checkout_expires_at: string
          claim_context: string
          claim_plan_key: string
          claim_state: string
          claim_subject_id: string
          claim_token: string
          generation: number
          lease_expires_at: string
          outcome: string
          reason: string
          stripe_checkout_session_id: string
        }[]
      }
      claim_recruiter_checkout_intent: {
        Args: { _plan: string; _recruiter_id: string; _user_id: string }
        Returns: {
          checkout_expires_at: string
          checkout_url: string
          claim_token: string
          generation: number
          intent_id: string
          outcome: string
          reason: string
          stripe_checkout_session_id: string
          stripe_customer_id: string
        }[]
      }
      claim_stripe_webhook_event: {
        Args: {
          p_event_id: string
          p_event_type: string
          p_lease_seconds: number
        }
        Returns: {
          attempt: number
          claim_token: string
          result: string
        }[]
      }
      clean_assistant_permissions: { Args: { _p: Json }; Returns: Json }
      complete_business_checkout_claim: {
        Args: {
          _checkout_expires_at: string
          _claim_token: string
          _context: string
          _session_id: string
          _user_id: string
        }
        Returns: {
          outcome: string
          reason: string
        }[]
      }
      complete_recruiter_checkout_intent: {
        Args: {
          _checkout_expires_at: string
          _checkout_url: string
          _claim_token: string
          _customer_id: string
          _intent_id: string
          _session_id: string
        }
        Returns: {
          outcome: string
          reason: string
        }[]
      }
      complete_stripe_webhook_event: {
        Args: {
          p_claim_token: string
          p_event_id: string
          p_result_code: string
        }
        Returns: boolean
      }
      create_agency: {
        Args: { _contact_email?: string; _description?: string; _name: string }
        Returns: {
          contact_email: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          owner_user_id: string
          slug: string | null
          status: Database["public"]["Enums"]["agency_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agency_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_agency_delegation_request: {
        Args: {
          _client_request_id: string
          _member_user_id: string
          _requested_permissions: Json
        }
        Returns: {
          agency_id: string
          client_request_id: string | null
          created_at: string
          created_by_user_id: string
          decided_at: string | null
          driver_user_id: string
          id: string
          member_invite_email: string
          member_user_id: string
          requested_permissions: Json
          status: Database["public"]["Enums"]["agency_delegation_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agency_delegation_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_agency_package: {
        Args: {
          _agency_id: string
          _billing_frequency_display_text: string
          _description: string
          _included_services: Json
          _name: string
          _price_display_text: string
          _recommended_permissions: Json
          _sort_order?: number
        }
        Returns: {
          agency_id: string
          billing_frequency_display_text: string | null
          created_at: string
          description: string | null
          id: string
          included_services: Json
          is_active: boolean
          name: string
          price_display_text: string | null
          recommended_permissions: Json
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agency_service_packages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_agency_work_item: {
        Args: {
          _agency_id: string
          _assigned_member_user_id: string
          _client_request_id: string
          _description: string
          _driver_user_id: string
          _due_date: string
          _priority: Database["public"]["Enums"]["agency_work_item_priority"]
          _title: string
          _type: Database["public"]["Enums"]["agency_work_item_type"]
        }
        Returns: {
          agency_id: string
          assigned_member_user_id: string | null
          client_request_id: string | null
          completed_at: string | null
          created_at: string
          created_by_user_id: string
          description: string | null
          driver_user_id: string
          due_date: string | null
          id: string
          last_driver_response: string | null
          last_driver_response_at: string | null
          priority: Database["public"]["Enums"]["agency_work_item_priority"]
          status: Database["public"]["Enums"]["agency_work_item_status"]
          title: string
          type: Database["public"]["Enums"]["agency_work_item_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agency_work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_driver_referral_safe: {
        Args: {
          _opportunity_id: string
          _recruiter_id: string
          _referred_driver_email?: string
          _referred_driver_name?: string
          _referred_driver_note?: string
          _referred_driver_phone?: string
        }
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
      current_user_can_manage_recruiter_opportunities: {
        Args: { _recruiter_id: string }
        Returns: boolean
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_my_professional_profile: { Args: never; Returns: boolean }
      delete_recruiter_opportunity: {
        Args: { p_opportunity_id: string }
        Returns: Json
      }
      driver_can_access_opportunity: {
        Args: { _opportunity_id: string; _recruiter_id: string }
        Returns: boolean
      }
      driver_decide_delegation: {
        Args: { _approve: boolean; _id: string }
        Returns: {
          agency_id: string
          client_request_id: string | null
          created_at: string
          created_by_user_id: string
          decided_at: string | null
          driver_user_id: string
          id: string
          member_invite_email: string
          member_user_id: string
          requested_permissions: Json
          status: Database["public"]["Enums"]["agency_delegation_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agency_delegation_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_respond_to_work_item: {
        Args: { _id: string; _response: string }
        Returns: string
      }
      effective_recruiter_active_opportunity_limit: {
        Args: { _recruiter_id: string }
        Returns: number
      }
      effective_recruiter_tier: {
        Args: { _recruiter_id: string }
        Returns: string
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_my_recruiter_setup_state: {
        Args: never
        Returns: {
          capability_status: string
          eligibility_state: string
          missing_requirements: string[]
          profile_created: boolean
          profile_id: string
          user_id: string
        }[]
      }
      expire_stale_contact_requests: { Args: never; Returns: number }
      fail_recruiter_checkout_intent: {
        Args: {
          _claim_token: string
          _error_code: string
          _intent_id: string
          _terminal: boolean
        }
        Returns: {
          outcome: string
          reason: string
        }[]
      }
      fail_stripe_webhook_event: {
        Args: {
          p_claim_token: string
          p_error_code: string
          p_event_id: string
        }
        Returns: boolean
      }
      finalize_my_account_data_deletion: {
        Args: never
        Returns: {
          agency_memberships_revoked: number
          deleted_user_id: string
          direct_rows_deleted: number
          relationship_rows_deleted: number
          shared_assignments_cleared: number
        }[]
      }
      get_agency_entitlement: {
        Args: { _agency_id: string }
        Returns: {
          active_client_limit: number | null
          agency_id: string
          created_at: string
          current_period_end: string | null
          id: string
          member_limit: number | null
          plan_key: string
          service_package_limit: number | null
          source: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agency_entitlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_agency_public_view: {
        Args: { _agency_id: string }
        Returns: {
          contact_email: string
          description: string
          id: string
          name: string
          status: string
        }[]
      }
      get_application_contract_summary: {
        Args: { _application_id: string }
        Returns: Json
      }
      get_effective_agency_limits: {
        Args: { _agency_id: string }
        Returns: {
          active_client_limit: number
          has_entitlement_row: boolean
          member_limit: number
          plan_key: string
          service_package_limit: number
          status: string
        }[]
      }
      get_my_agency: {
        Args: never
        Returns: {
          contact_email: string
          created_at: string
          description: string
          id: string
          my_role: Database["public"]["Enums"]["agency_member_role"]
          name: string
          owner_user_id: string
          status: Database["public"]["Enums"]["agency_status"]
          updated_at: string
        }[]
      }
      get_my_managed_drivers: { Args: never; Returns: Json[] }
      get_my_marketplace_restrictions: {
        Args: never
        Returns: {
          ends_at: string
          restriction: string
          scope: string
          starts_at: string
        }[]
      }
      get_my_professional_profile: {
        Args: never
        Returns: {
          availability: string
          bio: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          display_name: string
          professional_title: string | null
          service_areas: string[]
          services: string[]
          share_contact_details: boolean
          updated_at: string
          user_id: string
          visibility: string
          years_experience: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "professional_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_my_recruiter_profile_safe: { Args: never; Returns: Json[] }
      get_my_user_capabilities: {
        Args: never
        Returns: {
          activated_at: string
          capability: Database["public"]["Enums"]["user_capability_type"]
          status: Database["public"]["Enums"]["user_capability_status"]
        }[]
      }
      get_my_waiting_work_item: {
        Args: { _id: string }
        Returns: {
          agency_id: string
          agency_name: string
          created_at: string
          description: string
          due_date: string
          id: string
          last_driver_response: string
          last_driver_response_at: string
          priority: Database["public"]["Enums"]["agency_work_item_priority"]
          status: Database["public"]["Enums"]["agency_work_item_status"]
          title: string
          type: Database["public"]["Enums"]["agency_work_item_type"]
          updated_at: string
        }[]
      }
      get_public_resource_article: {
        Args: { _slug: string }
        Returns: {
          author_name: string
          content: string
          excerpt: string
          id: string
          meta_description: string
          published_at: string
          seo_title: string
          slug: string
          title: string
          topic_cluster: string
          updated_at: string
        }[]
      }
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
      invite_agency_member: {
        Args: {
          _agency_id: string
          _email: string
          _role?: Database["public"]["Enums"]["agency_member_role"]
        }
        Returns: Json
      }
      invite_assistant: {
        Args: { _email: string; _permissions: Json }
        Returns: Json
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_agency_member: {
        Args: { _agency_id: string; _uid: string }
        Returns: boolean
      }
      is_agency_owner: {
        Args: { _agency_id: string; _uid: string }
        Returns: boolean
      }
      is_agency_owner_or_admin: {
        Args: { _agency_id: string; _user_id?: string }
        Returns: boolean
      }
      is_application_party: {
        Args: { _application_id: string; _user_id: string }
        Returns: boolean
      }
      is_current_user_recruiter: { Args: never; Returns: boolean }
      is_recruiter_owner: {
        Args: { _recruiter_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      list_agency_audit_log: {
        Args: { _agency_id: string; _limit?: number }
        Returns: {
          action: string
          actor_user_id: string | null
          agency_id: string
          created_at: string
          driver_user_id: string | null
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          target_user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "agency_audit_log"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_agency_client_requests: {
        Args: { _agency_id: string }
        Returns: {
          assigned_member_user_id: string
          created_at: string
          decided_at: string
          driver_email: string
          driver_name: string
          driver_user_id: string
          id: string
          message: string
          package_name: string
          phone: string
          preferred_contact_method: string
          requested_permissions: Json
          selected_package_id: string
          status: Database["public"]["Enums"]["agency_client_request_status"]
        }[]
      }
      list_agency_clients: {
        Args: { _agency_id: string }
        Returns: {
          delegation_id: string
          driver_email: string
          driver_name: string
          driver_user_id: string
          last_activity_at: string
          member_email: string
          member_user_id: string
          package_id: string
          package_name: string
        }[]
      }
      list_agency_delegations: {
        Args: { _agency_id: string }
        Returns: {
          agency_id: string
          client_request_id: string | null
          created_at: string
          created_by_user_id: string
          decided_at: string | null
          driver_user_id: string
          id: string
          member_invite_email: string
          member_user_id: string
          requested_permissions: Json
          status: Database["public"]["Enums"]["agency_delegation_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "agency_delegation_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_agency_members: {
        Args: { _agency_id: string }
        Returns: {
          accepted_at: string
          agency_id: string
          id: string
          invite_email: string
          invited_at: string
          member_user_id: string
          revoked_at: string
          role: Database["public"]["Enums"]["agency_member_role"]
          status: Database["public"]["Enums"]["agency_member_status"]
        }[]
      }
      list_agency_packages_public: {
        Args: { _agency_id: string }
        Returns: {
          agency_id: string
          billing_frequency_display_text: string | null
          created_at: string
          description: string | null
          id: string
          included_services: Json
          is_active: boolean
          name: string
          price_display_text: string | null
          recommended_permissions: Json
          sort_order: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "agency_service_packages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_agency_work_items: {
        Args: {
          _agency_id: string
          _assigned_member_user_id?: string
          _driver_user_id?: string
          _status?: Database["public"]["Enums"]["agency_work_item_status"]
        }
        Returns: {
          agency_id: string
          assigned_member_email: string
          assigned_member_user_id: string
          client_request_id: string
          completed_at: string
          created_at: string
          description: string
          driver_email: string
          driver_user_id: string
          due_date: string
          id: string
          priority: Database["public"]["Enums"]["agency_work_item_priority"]
          status: Database["public"]["Enums"]["agency_work_item_status"]
          title: string
          type: Database["public"]["Enums"]["agency_work_item_type"]
        }[]
      }
      list_authorized_professional_profiles: {
        Args: { _user_ids: string[] }
        Returns: {
          availability: string
          bio: string
          contact_email: string
          contact_phone: string
          display_name: string
          professional_title: string
          service_areas: string[]
          services: string[]
          share_contact_details: boolean
          updated_at: string
          user_id: string
          visibility: string
          years_experience: number
        }[]
      }
      list_driver_assistant_audit: {
        Args: { _limit?: number }
        Returns: {
          action: string
          assistant_email: string
          assistant_user_id: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
        }[]
      }
      list_driver_visible_opportunities: {
        Args: { _driver_type?: string; _route_type?: string; _state?: string }
        Returns: {
          actual_benefits: string | null
          admin_review_status: string
          benefits: string | null
          canonical_version: number | null
          company_name: string
          cpm: number | null
          created_at: string
          deadhead_paid: boolean | null
          description: string | null
          detention_pay: string | null
          driver_type: string | null
          employment_model: string | null
          equipment_year: string | null
          escrow_amount: number | null
          escrow_amount_frequency: string | null
          escrow_required: boolean
          escrow_required_state: string | null
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
          insurance_deduction_frequency: string | null
          insurance_deductions: number | null
          layover_pay: string | null
          lease_payment: number | null
          lease_payment_frequency: string | null
          maintenance_deduction_frequency: string | null
          maintenance_deductions: number | null
          mixed_pay_components: Json
          other_deduction_frequency: string | null
          other_deductions: number | null
          other_pay_method_label: string | null
          other_weekly_gross: number | null
          pay_model: string | null
          percentage_basis_label: string | null
          percentage_pay: number | null
          percentage_weekly_revenue_basis: number | null
          pets_allowed: boolean | null
          published_at: string | null
          recruiter_id: string
          requirements: string | null
          riders_allowed: boolean | null
          route_type: string | null
          salary_amount: number | null
          salary_frequency: string | null
          sign_on_bonus: number | null
          status: string
          team_configuration: string | null
          title: string
          trailer_type: string | null
          transparency_confirmed: boolean
          typical_lanes: string | null
          updated_at: string
          view_count: number
        }[]
        SetofOptions: {
          from: "*"
          to: "opportunities"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_my_agency_client_requests: {
        Args: never
        Returns: {
          agency_id: string
          agency_name: string
          created_at: string
          decided_at: string
          id: string
          message: string
          package_name: string
          selected_package_id: string
          status: Database["public"]["Enums"]["agency_client_request_status"]
        }[]
      }
      list_my_assistant_audit: {
        Args: { _limit?: number }
        Returns: {
          action: string
          created_at: string
          driver_email: string
          driver_user_id: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
        }[]
      }
      list_my_assistants: { Args: never; Returns: Json[] }
      list_my_assistants_with_source: { Args: never; Returns: Json[] }
      list_my_driver_agency_audit_log: {
        Args: { _limit?: number }
        Returns: {
          action: string
          actor_user_id: string | null
          agency_id: string
          created_at: string
          driver_user_id: string | null
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          target_user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "agency_audit_log"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_my_driver_referrals: {
        Args: never
        Returns: {
          created_at: string
          id: string
          last_status_at: string
          opportunity_company_name: string
          opportunity_hiring_city: string
          opportunity_hiring_state: string
          opportunity_id: string
          opportunity_title: string
          recruiter_id: string
          referred_driver_name: string
          referred_driver_user_id: string
          referring_driver_id: string
          status: string
          updated_at: string
        }[]
      }
      list_my_pending_assistant_invites: {
        Args: never
        Returns: {
          driver_user_id: string
          id: string
          invite_email: string
          invited_at: string
          permissions: Json
        }[]
      }
      list_my_pending_delegations: {
        Args: never
        Returns: {
          agency_id: string
          agency_name: string
          client_request_id: string
          created_at: string
          id: string
          member_email: string
          member_name: string
          member_user_id: string
          package_name: string
          requested_permissions: Json
          status: Database["public"]["Enums"]["agency_delegation_status"]
        }[]
      }
      list_my_waiting_work_items: {
        Args: never
        Returns: {
          agency_id: string
          agency_name: string
          created_at: string
          description: string
          due_date: string
          id: string
          priority: Database["public"]["Enums"]["agency_work_item_priority"]
          title: string
          type: Database["public"]["Enums"]["agency_work_item_type"]
          updated_at: string
        }[]
      }
      list_public_resource_articles: {
        Args: { _limit?: number }
        Returns: {
          excerpt: string
          id: string
          published_at: string
          slug: string
          title: string
          topic_cluster: string
        }[]
      }
      list_recruiter_application_summaries: {
        Args: { _recruiter_id: string }
        Returns: {
          created_at: string
          id: string
          opportunity_id: string
          status: string
          updated_at: string
        }[]
      }
      list_recruiter_applications_safe: {
        Args: { _recruiter_id: string }
        Returns: Json[]
      }
      log_assistant_action: {
        Args: {
          _action: string
          _driver: string
          _entity_id?: string
          _entity_type?: string
          _metadata?: Json
        }
        Returns: string
      }
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
      opportunity_publication_blockers: {
        Args: { o: Database["public"]["Tables"]["opportunities"]["Row"] }
        Returns: string[]
      }
      persist_my_recruiter_profile: {
        Args: {
          _company_address: string
          _company_city: string
          _company_name: string
          _company_phone: string
          _company_state: string
          _company_type: string
          _company_website: string
          _dot_number: string
          _driver_types_hired: string[]
          _equipment_types: string[]
          _hiring_states: string[]
          _mc_number: string
          _recruiter_email: string
          _recruiter_name: string
          _recruiter_phone: string
        }
        Returns: {
          company_name: string
          company_type: string
          dot_number: string
          id: string
          mc_number: string
          recruiter_email: string
          recruiter_name: string
        }[]
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
      record_driver_application_response: {
        Args: { application_id: string; note?: string; response_type: string }
        Returns: string
      }
      recruiter_has_priority_plan: {
        Args: { _recruiter_id: string }
        Returns: boolean
      }
      recruiter_plan_limit: { Args: { _plan: string }; Returns: number }
      recruiter_profile_can_manage_opportunities: {
        Args: { _recruiter_id: string }
        Returns: boolean
      }
      referral_status_rank: { Args: { _s: string }; Returns: number }
      release_business_checkout_claim: {
        Args: {
          _claim_token: string
          _context: string
          _error_code: string
          _terminal: boolean
          _user_id: string
        }
        Returns: {
          outcome: string
          reason: string
        }[]
      }
      request_driver_contact: {
        Args: { application_id: string; recruiter_note?: string }
        Returns: string
      }
      resolve_agency_slug: { Args: { _slug: string }; Returns: string }
      respond_to_contact_request: {
        Args: { decision: string; driver_note?: string; request_id: string }
        Returns: undefined
      }
      resubmit_recruiter_profile: {
        Args: { profile_id: string }
        Returns: undefined
      }
      revoke_agency_delegation: {
        Args: { _delegation_id: string }
        Returns: {
          agency_id: string
          client_request_id: string | null
          created_at: string
          created_by_user_id: string
          decided_at: string | null
          driver_user_id: string
          id: string
          member_invite_email: string
          member_user_id: string
          requested_permissions: Json
          status: Database["public"]["Enums"]["agency_delegation_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agency_delegation_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_agency_member: { Args: { _member_id: string }; Returns: undefined }
      revoke_assistant: { Args: { _id: string }; Returns: undefined }
      set_agency_client_request_status: {
        Args: {
          _assigned_member_user_id?: string
          _id: string
          _status: Database["public"]["Enums"]["agency_client_request_status"]
        }
        Returns: {
          agency_id: string
          assigned_member_user_id: string | null
          created_at: string
          decided_at: string | null
          decided_by_user_id: string | null
          driver_user_id: string
          id: string
          message: string | null
          phone: string | null
          preferred_contact_method: string | null
          requested_permissions: Json
          selected_package_id: string | null
          status: Database["public"]["Enums"]["agency_client_request_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agency_client_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_agency_slug: {
        Args: { _agency_id: string; _slug: string }
        Returns: string
      }
      submit_agency_client_request: {
        Args: {
          _agency_id: string
          _consent: boolean
          _message: string
          _phone: string
          _preferred_contact_method: string
          _selected_package_id: string
        }
        Returns: {
          agency_id: string
          assigned_member_user_id: string | null
          created_at: string
          decided_at: string | null
          decided_by_user_id: string | null
          driver_user_id: string
          id: string
          message: string | null
          phone: string | null
          preferred_contact_method: string | null
          requested_permissions: Json
          selected_package_id: string | null
          status: Database["public"]["Enums"]["agency_client_request_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agency_client_requests"
          isOneToOne: true
          isSetofReturn: false
        }
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
      submit_opportunity_application: {
        Args: {
          _availability_confirmed: boolean
          _contact_sharing_consent: boolean
          _idempotency_key: string
          _message: string
          _opportunity_id: string
          _preferred_contact_method: string
          _requirements_confirmed: boolean
          _truth_attestation: boolean
        }
        Returns: {
          application_id: string
          application_status: string
          result_code: string
        }[]
      }
      submit_request_info: {
        Args: {
          _contact_sharing_consent: boolean
          _idempotency_key: string
          _opportunity_id: string
          _preferred_contact_method: string
          _question: string
        }
        Returns: {
          application_id: string
          application_status: string
          result_code: string
        }[]
      }
      update_agency_package: {
        Args: {
          _billing_frequency_display_text: string
          _description: string
          _id: string
          _included_services: Json
          _is_active: boolean
          _name: string
          _price_display_text: string
          _recommended_permissions: Json
          _sort_order: number
        }
        Returns: {
          agency_id: string
          billing_frequency_display_text: string | null
          created_at: string
          description: string | null
          id: string
          included_services: Json
          is_active: boolean
          name: string
          price_display_text: string | null
          recommended_permissions: Json
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agency_service_packages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_agency_work_item: {
        Args: {
          _assigned_member_user_id: string
          _description: string
          _due_date: string
          _id: string
          _priority: Database["public"]["Enums"]["agency_work_item_priority"]
          _status: Database["public"]["Enums"]["agency_work_item_status"]
          _title: string
        }
        Returns: {
          agency_id: string
          assigned_member_user_id: string | null
          client_request_id: string | null
          completed_at: string | null
          created_at: string
          created_by_user_id: string
          description: string | null
          driver_user_id: string
          due_date: string | null
          id: string
          last_driver_response: string | null
          last_driver_response_at: string | null
          priority: Database["public"]["Enums"]["agency_work_item_priority"]
          status: Database["public"]["Enums"]["agency_work_item_status"]
          title: string
          type: Database["public"]["Enums"]["agency_work_item_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agency_work_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_assistant_permissions: {
        Args: { _id: string; _permissions: Json }
        Returns: undefined
      }
      update_my_agency: {
        Args: {
          _contact_email: string
          _description: string
          _name: string
          _status: Database["public"]["Enums"]["agency_status"]
        }
        Returns: {
          contact_email: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          owner_user_id: string
          slug: string | null
          status: Database["public"]["Enums"]["agency_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agency_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_my_professional_profile: {
        Args: {
          p_availability?: string
          p_bio?: string
          p_contact_email?: string
          p_contact_phone?: string
          p_display_name: string
          p_professional_title?: string
          p_service_areas?: string[]
          p_services?: string[]
          p_share_contact_details?: boolean
          p_visibility?: string
          p_years_experience?: number
        }
        Returns: {
          availability: string
          bio: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          display_name: string
          professional_title: string | null
          service_areas: string[]
          services: string[]
          share_contact_details: boolean
          updated_at: string
          user_id: string
          visibility: string
          years_experience: number | null
        }
        SetofOptions: {
          from: "*"
          to: "professional_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      user_is_marketplace_blocked: {
        Args: { _scope: string; _user_id: string }
        Returns: boolean
      }
      withdraw_opportunity_application: {
        Args: { application_id: string }
        Returns: undefined
      }
    }
    Enums: {
      agency_client_request_status:
        | "pending"
        | "approved"
        | "declined"
        | "cancelled"
        | "converted_to_client"
      agency_delegation_status:
        | "pending_driver_approval"
        | "approved"
        | "declined"
        | "revoked"
        | "expired"
      agency_member_role: "agency_owner" | "agency_admin" | "agency_member"
      agency_member_status: "pending" | "active" | "revoked"
      agency_status: "active" | "disabled"
      agency_work_item_priority: "low" | "normal" | "high"
      agency_work_item_status:
        | "open"
        | "in_progress"
        | "waiting_on_driver"
        | "completed"
        | "cancelled"
      agency_work_item_type:
        | "load_entry"
        | "expense_entry"
        | "fuel_entry"
        | "report_review"
        | "monthly_closeout"
        | "document_followup"
        | "other"
      assistant_status: "pending" | "active" | "revoked" | "expired"
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
      user_capability_status: "setup" | "active" | "suspended" | "revoked"
      user_capability_type: "driver" | "recruiter"
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
      agency_client_request_status: [
        "pending",
        "approved",
        "declined",
        "cancelled",
        "converted_to_client",
      ],
      agency_delegation_status: [
        "pending_driver_approval",
        "approved",
        "declined",
        "revoked",
        "expired",
      ],
      agency_member_role: ["agency_owner", "agency_admin", "agency_member"],
      agency_member_status: ["pending", "active", "revoked"],
      agency_status: ["active", "disabled"],
      agency_work_item_priority: ["low", "normal", "high"],
      agency_work_item_status: [
        "open",
        "in_progress",
        "waiting_on_driver",
        "completed",
        "cancelled",
      ],
      agency_work_item_type: [
        "load_entry",
        "expense_entry",
        "fuel_entry",
        "report_review",
        "monthly_closeout",
        "document_followup",
        "other",
      ],
      assistant_status: ["pending", "active", "revoked", "expired"],
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
      user_capability_status: ["setup", "active", "suspended", "revoked"],
      user_capability_type: ["driver", "recruiter"],
    },
  },
} as const
