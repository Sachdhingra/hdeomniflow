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
      leads: {
        Row: {
          assigned_to: string | null
          category: Database["public"]["Enums"]["lead_category"]
          created_at: string
          created_by: string
          customer_name: string
          customer_phone: string
          delivery_assigned_to: string | null
          delivery_date: string | null
          delivery_notes: string | null
          id: string
          last_follow_up: string
          next_follow_up_date: string | null
          next_follow_up_time: string | null
          notes: string | null
          source: string
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
          updated_by: string
          value_in_rupees: number
        }
        Insert: {
          assigned_to?: string | null
          category: Database["public"]["Enums"]["lead_category"]
          created_at?: string
          created_by: string
          customer_name: string
          customer_phone: string
          delivery_assigned_to?: string | null
          delivery_date?: string | null
          delivery_notes?: string | null
          id?: string
          last_follow_up?: string
          next_follow_up_date?: string | null
          next_follow_up_time?: string | null
          notes?: string | null
          source?: string
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          updated_by: string
          value_in_rupees?: number
        }
        Update: {
          assigned_to?: string | null
          category?: Database["public"]["Enums"]["lead_category"]
          created_at?: string
          created_by?: string
          customer_name?: string
          customer_phone?: string
          delivery_assigned_to?: string | null
          delivery_date?: string | null
          delivery_notes?: string | null
          id?: string
          last_follow_up?: string
          next_follow_up_date?: string | null
          next_follow_up_time?: string | null
          notes?: string | null
          source?: string
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          updated_by?: string
          value_in_rupees?: number
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
      profiles: {
        Row: {
          active: boolean
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          email: string
          id: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          updated_at?: string
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
          agent_id: string
          budget: number | null
          category: Database["public"]["Enums"]["lead_category"] | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          date: string
          follow_up_date: string | null
          id: string
          lat: number | null
          leads_generated: number
          lng: number | null
          location: string
          notes: string | null
          photos: string[] | null
          society: string
          status: string | null
        }
        Insert: {
          agent_id: string
          budget?: number | null
          category?: Database["public"]["Enums"]["lead_category"] | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          date?: string
          follow_up_date?: string | null
          id?: string
          lat?: number | null
          leads_generated?: number
          lng?: number | null
          location?: string
          notes?: string | null
          photos?: string[] | null
          society?: string
          status?: string | null
        }
        Update: {
          agent_id?: string
          budget?: number | null
          category?: Database["public"]["Enums"]["lead_category"] | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          date?: string
          follow_up_date?: string | null
          id?: string
          lat?: number | null
          leads_generated?: number
          lng?: number | null
          location?: string
          notes?: string | null
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
      service_job_status: "pending" | "assigned" | "in_progress" | "completed"
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
      ],
      service_job_status: ["pending", "assigned", "in_progress", "completed"],
      service_job_type: ["service", "delivery"],
    },
  },
} as const
