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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      agent_scores: {
        Row: {
          agent_id: string
          calculated_at: string
          flags_count: number
          id: string
          jobs_completed: number
          on_time_pct: number
          period: string
          reschedule_count: number
          score: number
        }
        Insert: {
          agent_id: string
          calculated_at?: string
          flags_count?: number
          id?: string
          jobs_completed?: number
          on_time_pct?: number
          period?: string
          reschedule_count?: number
          score?: number
        }
        Update: {
          agent_id?: string
          calculated_at?: string
          flags_count?: number
          id?: string
          jobs_completed?: number
          on_time_pct?: number
          period?: string
          reschedule_count?: number
          score?: number
        }
        Relationships: []
      }
      audit_flags: {
        Row: {
          agent_id: string
          created_at: string
          description: string
          flag_type: string
          id: string
          job_id: string | null
          resolved: boolean
          severity: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          description: string
          flag_type: string
          id?: string
          job_id?: string | null
          resolved?: boolean
          severity?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          description?: string
          flag_type?: string
          id?: string
          job_id?: string | null
          resolved?: boolean
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_flags_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_nurture_messages: {
        Row: {
          concern_type: string | null
          created_at: string
          customer_opened: boolean
          customer_response: string | null
          days_in_stage: number
          error_message: string | null
          id: string
          lead_id: string
          message_body: string
          message_type: string
          responded_at: string | null
          scheduled_for: string | null
          sent_at: string | null
          status: string
          trigger_stage: string
          twilio_message_sid: string | null
        }
        Insert: {
          concern_type?: string | null
          created_at?: string
          customer_opened?: boolean
          customer_response?: string | null
          days_in_stage?: number
          error_message?: string | null
          id?: string
          lead_id: string
          message_body: string
          message_type: string
          responded_at?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          trigger_stage: string
          twilio_message_sid?: string | null
        }
        Update: {
          concern_type?: string | null
          created_at?: string
          customer_opened?: boolean
          customer_response?: string | null
          days_in_stage?: number
          error_message?: string | null
          id?: string
          lead_id?: string
          message_body?: string
          message_type?: string
          responded_at?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          trigger_stage?: string
          twilio_message_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auto_nurture_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_logs: {
        Row: {
          details: Json | null
          error_message: string | null
          event_type: string
          executed_at: string
          id: string
          lead_id: string | null
          success: boolean
        }
        Insert: {
          details?: Json | null
          error_message?: string | null
          event_type: string
          executed_at?: string
          id?: string
          lead_id?: string | null
          success?: boolean
        }
        Update: {
          details?: Json | null
          error_message?: string | null
          event_type?: string
          executed_at?: string
          id?: string
          lead_id?: string | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          product_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          product_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          product_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      deletion_logs: {
        Row: {
          deleted_at: string
          deleted_by: string
          id: string
          reason: string | null
          record_id: string
          record_snapshot: Json | null
          table_name: string
        }
        Insert: {
          deleted_at?: string
          deleted_by: string
          id?: string
          reason?: string | null
          record_id: string
          record_snapshot?: Json | null
          table_name: string
        }
        Update: {
          deleted_at?: string
          deleted_by?: string
          id?: string
          reason?: string | null
          record_id?: string
          record_snapshot?: Json | null
          table_name?: string
        }
        Relationships: []
      }
      lead_stage_history: {
        Row: {
          changed_at: string
          changed_by_id: string | null
          id: string
          lead_id: string
          new_stage: string
          old_stage: string | null
          reason: string | null
        }
        Insert: {
          changed_at?: string
          changed_by_id?: string | null
          id?: string
          lead_id: string
          new_stage: string
          old_stage?: string | null
          reason?: string | null
        }
        Update: {
          changed_at?: string
          changed_by_id?: string | null
          id?: string
          lead_id?: string
          new_stage?: string
          old_stage?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_stage_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          category: Database["public"]["Enums"]["lead_category"]
          concern_type: string | null
          conversion_probability: number | null
          created_at: string
          created_by: string
          created_by_agent_id: string | null
          created_from_lat: number | null
          created_from_lng: number | null
          created_from_location: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string
          deleted_at: string | null
          deleted_by: string | null
          delivery_assigned_to: string | null
          delivery_date: string | null
          delivery_notes: string | null
          family_visit_date: string | null
          has_family: boolean | null
          id: string
          last_follow_up: string
          liked_product: string | null
          next_action_suggested: string | null
          next_follow_up_date: string | null
          next_follow_up_time: string | null
          notes: string | null
          price_sensitivity: string | null
          products_viewed: Json | null
          source: string
          source_type: string | null
          stage_changed_at: string | null
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
          updated_by: string
          value_in_rupees: number
          visit_date: string | null
          visit_photo: string | null
          why_lost: string | null
        }
        Insert: {
          assigned_to?: string | null
          category: Database["public"]["Enums"]["lead_category"]
          concern_type?: string | null
          conversion_probability?: number | null
          created_at?: string
          created_by: string
          created_by_agent_id?: string | null
          created_from_lat?: number | null
          created_from_lng?: number | null
          created_from_location?: string | null
          customer_email?: string | null
          customer_name: string
          customer_phone: string
          deleted_at?: string | null
          deleted_by?: string | null
          delivery_assigned_to?: string | null
          delivery_date?: string | null
          delivery_notes?: string | null
          family_visit_date?: string | null
          has_family?: boolean | null
          id?: string
          last_follow_up?: string
          liked_product?: string | null
          next_action_suggested?: string | null
          next_follow_up_date?: string | null
          next_follow_up_time?: string | null
          notes?: string | null
          price_sensitivity?: string | null
          products_viewed?: Json | null
          source?: string
          source_type?: string | null
          stage_changed_at?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          updated_by: string
          value_in_rupees?: number
          visit_date?: string | null
          visit_photo?: string | null
          why_lost?: string | null
        }
        Update: {
          assigned_to?: string | null
          category?: Database["public"]["Enums"]["lead_category"]
          concern_type?: string | null
          conversion_probability?: number | null
          created_at?: string
          created_by?: string
          created_by_agent_id?: string | null
          created_from_lat?: number | null
          created_from_lng?: number | null
          created_from_location?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string
          deleted_at?: string | null
          deleted_by?: string | null
          delivery_assigned_to?: string | null
          delivery_date?: string | null
          delivery_notes?: string | null
          family_visit_date?: string | null
          has_family?: boolean | null
          id?: string
          last_follow_up?: string
          liked_product?: string | null
          next_action_suggested?: string | null
          next_follow_up_date?: string | null
          next_follow_up_time?: string | null
          notes?: string | null
          price_sensitivity?: string | null
          products_viewed?: Json | null
          source?: string
          source_type?: string | null
          stage_changed_at?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          updated_by?: string
          value_in_rupees?: number
          visit_date?: string | null
          visit_photo?: string | null
          why_lost?: string | null
        }
        Relationships: []
      }
      message_logs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message: string
          phone: string
          provider: string
          recipient_name: string | null
          recipient_user_id: string | null
          retry_count: number
          sent_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message: string
          phone: string
          provider?: string
          recipient_name?: string | null
          recipient_user_id?: string | null
          retry_count?: number
          sent_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message?: string
          phone?: string
          provider?: string
          recipient_name?: string | null
          recipient_user_id?: string | null
          retry_count?: number
          sent_at?: string | null
          status?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          link: string | null
          message: string
          read: boolean
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          link?: string | null
          message: string
          read?: boolean
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          link?: string | null
          message?: string
          read?: boolean
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          brand_code: string | null
          category_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          hsn_code: string | null
          id: string
          line_code: string | null
          net_price: number
          product_name: string
          sku: string
          status: string
          updated_at: string
        }
        Insert: {
          brand_code?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          hsn_code?: string | null
          id?: string
          line_code?: string | null
          net_price?: number
          product_name: string
          sku: string
          status?: string
          updated_at?: string
        }
        Update: {
          brand_code?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          hsn_code?: string | null
          id?: string
          line_code?: string | null
          net_price?: number
          product_name?: string
          sku?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          name: string
          phone_number: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          email: string
          id: string
          name: string
          phone_number?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          phone_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reschedule_history: {
        Row: {
          created_at: string
          id: string
          job_id: string
          new_date: string
          original_date: string | null
          reason: string
          rescheduled_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          new_date: string
          original_date?: string | null
          reason: string
          rescheduled_by: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          new_date?: string
          original_date?: string | null
          reason?: string
          rescheduled_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "reschedule_history_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_targets: {
        Row: {
          created_at: string
          id: string
          month: string
          target_value: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          month: string
          target_value?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          month?: string
          target_value?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      service_jobs: {
        Row: {
          accepted_at: string | null
          address: string
          agent_reached_at: string | null
          assigned_agent: string | null
          category: Database["public"]["Enums"]["lead_category"]
          claim_due_date: string | null
          claim_part_no: string | null
          claim_reason: string | null
          completed_at: string | null
          created_at: string
          customer_name: string
          customer_phone: string
          date_received: string
          date_to_attend: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string
          id: string
          is_foc: boolean
          photos: string[] | null
          remarks: string | null
          source_lead_id: string | null
          status: Database["public"]["Enums"]["service_job_status"]
          travel_started_at: string | null
          type: Database["public"]["Enums"]["service_job_type"]
          updated_at: string
          value: number
        }
        Insert: {
          accepted_at?: string | null
          address?: string
          agent_reached_at?: string | null
          assigned_agent?: string | null
          category: Database["public"]["Enums"]["lead_category"]
          claim_due_date?: string | null
          claim_part_no?: string | null
          claim_reason?: string | null
          completed_at?: string | null
          created_at?: string
          customer_name: string
          customer_phone: string
          date_received?: string
          date_to_attend?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string
          id?: string
          is_foc?: boolean
          photos?: string[] | null
          remarks?: string | null
          source_lead_id?: string | null
          status?: Database["public"]["Enums"]["service_job_status"]
          travel_started_at?: string | null
          type?: Database["public"]["Enums"]["service_job_type"]
          updated_at?: string
          value?: number
        }
        Update: {
          accepted_at?: string | null
          address?: string
          agent_reached_at?: string | null
          assigned_agent?: string | null
          category?: Database["public"]["Enums"]["lead_category"]
          claim_due_date?: string | null
          claim_part_no?: string | null
          claim_reason?: string | null
          completed_at?: string | null
          created_at?: string
          customer_name?: string
          customer_phone?: string
          date_received?: string
          date_to_attend?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string
          id?: string
          is_foc?: boolean
          photos?: string[] | null
          remarks?: string | null
          source_lead_id?: string | null
          status?: Database["public"]["Enums"]["service_job_status"]
          travel_started_at?: string | null
          type?: Database["public"]["Enums"]["service_job_type"]
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_jobs_source_lead_id_fkey"
            columns: ["source_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      site_visits: {
        Row: {
          accuracy_meters: number | null
          agent_id: string
          budget: number | null
          category: Database["public"]["Enums"]["lead_category"] | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          date: string
          deleted_at: string | null
          deleted_by: string | null
          follow_up_date: string | null
          gps_timestamp: string | null
          id: string
          lat: number | null
          leads_generated: number
          lng: number | null
          location: string
          notes: string | null
          photo_url: string | null
          photos: string[] | null
          society: string
          status: string | null
        }
        Insert: {
          accuracy_meters?: number | null
          agent_id: string
          budget?: number | null
          category?: Database["public"]["Enums"]["lead_category"] | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          date?: string
          deleted_at?: string | null
          deleted_by?: string | null
          follow_up_date?: string | null
          gps_timestamp?: string | null
          id?: string
          lat?: number | null
          leads_generated?: number
          lng?: number | null
          location?: string
          notes?: string | null
          photo_url?: string | null
          photos?: string[] | null
          society?: string
          status?: string | null
        }
        Update: {
          accuracy_meters?: number | null
          agent_id?: string
          budget?: number | null
          category?: Database["public"]["Enums"]["lead_category"] | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          date?: string
          deleted_at?: string | null
          deleted_by?: string | null
          follow_up_date?: string | null
          gps_timestamp?: string | null
          id?: string
          lat?: number | null
          leads_generated?: number
          lng?: number | null
          location?: string
          notes?: string | null
          photo_url?: string | null
          photos?: string[] | null
          society?: string
          status?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_conversion_probability: {
        Args: { _lead_id: string }
        Returns: number
      }
      get_dashboard_summary: { Args: never; Returns: Json }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "sales"
        | "service_head"
        | "field_agent"
        | "site_agent"
      lead_category:
        | "sofa"
        | "coffee_table"
        | "almirah"
        | "dining"
        | "mattress"
        | "bed"
        | "kitchen"
        | "chair"
        | "office_table"
        | "others"
      lead_status:
        | "new"
        | "contacted"
        | "follow_up"
        | "negotiation"
        | "won"
        | "lost"
        | "overdue"
        | "converted"
      service_job_status:
        | "pending"
        | "assigned"
        | "in_progress"
        | "completed"
        | "on_route"
        | "on_site"
        | "rescheduled"
      service_job_type: "service" | "delivery"
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
      app_role: ["admin", "sales", "service_head", "field_agent", "site_agent"],
      lead_category: [
        "sofa",
        "coffee_table",
        "almirah",
        "dining",
        "mattress",
        "bed",
        "kitchen",
        "chair",
        "office_table",
        "others",
      ],
      lead_status: [
        "new",
        "contacted",
        "follow_up",
        "negotiation",
        "won",
        "lost",
        "overdue",
        "converted",
      ],
      service_job_status: [
        "pending",
        "assigned",
        "in_progress",
        "completed",
        "on_route",
        "on_site",
        "rescheduled",
      ],
      service_job_type: ["service", "delivery"],
    },
  },
} as const
