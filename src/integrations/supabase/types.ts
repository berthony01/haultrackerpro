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
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          expense_date: string
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
          created_at: string
          deadhead_miles: number
          detention_fee: number
          dropoff_location: string
          estimated_pay: number | null
          gross_revenue: number | null
          id: string
          load_date: string
          loaded_miles: number
          notes: string | null
          other_fees: number
          pickup_location: string
          rate_per_mile: number
          status: string
          updated_at: string
          user_id: string
          wait_fee: number
        }
        Insert: {
          actual_pay_received?: number | null
          created_at?: string
          deadhead_miles?: number
          detention_fee?: number
          dropoff_location: string
          estimated_pay?: number | null
          gross_revenue?: number | null
          id?: string
          load_date: string
          loaded_miles?: number
          notes?: string | null
          other_fees?: number
          pickup_location: string
          rate_per_mile?: number
          status?: string
          updated_at?: string
          user_id: string
          wait_fee?: number
        }
        Update: {
          actual_pay_received?: number | null
          created_at?: string
          deadhead_miles?: number
          detention_fee?: number
          dropoff_location?: string
          estimated_pay?: number | null
          gross_revenue?: number | null
          id?: string
          load_date?: string
          loaded_miles?: number
          notes?: string | null
          other_fees?: number
          pickup_location?: string
          rate_per_mile?: number
          status?: string
          updated_at?: string
          user_id?: string
          wait_fee?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          stripe_customer_id: string | null
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
          subscription_expires_at?: string | null
          subscription_plan?: string | null
          subscription_status?: string
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
          default_other_fees: number | null
          default_rate_per_mile: number | null
          federal_tax_percent: number | null
          id: string
          include_se_tax: boolean | null
          onboarding_completed: boolean
          pay_percentage: number | null
          pay_type: string
          se_tax_percent: number | null
          state_tax_percent: number | null
          tax_base_type: string | null
          tax_estimator_enabled: boolean
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
          id?: string
          include_se_tax?: boolean | null
          onboarding_completed?: boolean
          pay_percentage?: number | null
          pay_type?: string
          se_tax_percent?: number | null
          state_tax_percent?: number | null
          tax_base_type?: string | null
          tax_estimator_enabled?: boolean
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
          id?: string
          include_se_tax?: boolean | null
          onboarding_completed?: boolean
          pay_percentage?: number | null
          pay_type?: string
          se_tax_percent?: number | null
          state_tax_percent?: number | null
          tax_base_type?: string | null
          tax_estimator_enabled?: boolean
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
      [_ in never]: never
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
