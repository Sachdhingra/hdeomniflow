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
      accounts_approvals_log: {
        Row: {
          action: string
          amount_verified: number | null
          dues_checked: boolean | null
          id: string
          notes: string | null
          performed_at: string
          performed_by: string
          service_job_id: string
        }
        Insert: {
          action: string
          amount_verified?: number | null
          dues_checked?: boolean | null
          id?: string
          notes?: string | null
          performed_at?: string
          performed_by: string
          service_job_id: string
        }
        Update: {
          action?: string
          amount_verified?: number | null
          dues_checked?: boolean | null
          id?: string
          notes?: string | null
          performed_at?: string
          performed_by?: string
          service_job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_approvals_log_service_job_id_fkey"
            columns: ["service_job_id"]
            isOneToOne: false
            referencedRelation: "service_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_live_locations: {
        Row: {
          agent_id: string
          agent_name: string
          captured_at: string
          created_at: string
          id: string
          latitude: number
          longitude: number
          shift_date: string
        }
        Insert: {
          agent_id: string
          agent_name: string
          captured_at?: string
          created_at?: string
          id?: string
          latitude: number
          longitude: number
          shift_date?: string
        }
        Update: {
          agent_id?: string
          agent_name?: string
          captured_at?: string
          created_at?: string
          id?: string
          latitude?: number
          longitude?: number
          shift_date?: string
        }
        Relationships: []
      }
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
      agent_signal_logs: {
        Row: {
          agent_id: string | null
          agent_name: string | null
          created_at: string
          duration_minutes: number | null
          event_type: string
          id: string
          occurred_at: string
          shift_date: string
        }
        Insert: {
          agent_id?: string | null
          agent_name?: string | null
          created_at?: string
          duration_minutes?: number | null
          event_type: string
          id?: string
          occurred_at?: string
          shift_date?: string
        }
        Update: {
          agent_id?: string | null
          agent_name?: string | null
          created_at?: string
          duration_minutes?: number | null
          event_type?: string
          id?: string
          occurred_at?: string
          shift_date?: string
        }
        Relationships: []
      }
      app_service_requests: {
        Row: {
          contact_phone: string
          created_at: string
          customer_id: string
          id: string
          issue_description: string
          preferred_callback: string | null
          product_description: string
          status: string
        }
        Insert: {
          contact_phone: string
          created_at?: string
          customer_id: string
          id?: string
          issue_description: string
          preferred_callback?: string | null
          product_description: string
          status?: string
        }
        Update: {
          contact_phone?: string
          created_at?: string
          customer_id?: string
          id?: string
          issue_description?: string
          preferred_callback?: string | null
          product_description?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_service_requests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "elite_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: []
      }
      app_users: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          onesignal_player_id: string | null
          push_enabled: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          onesignal_player_id?: string | null
          push_enabled?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          onesignal_player_id?: string | null
          push_enabled?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_users_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "elite_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          clock_in: string | null
          clock_in_lat: number | null
          clock_in_lng: number | null
          clock_out: string | null
          clock_out_lat: number | null
          clock_out_lng: number | null
          created_at: string
          date: string
          id: string
          minutes_late: number
          notes: string | null
          status: string
          updated_at: string
          user_id: string
          working_hours: number | null
        }
        Insert: {
          clock_in?: string | null
          clock_in_lat?: number | null
          clock_in_lng?: number | null
          clock_out?: string | null
          clock_out_lat?: number | null
          clock_out_lng?: number | null
          created_at?: string
          date: string
          id?: string
          minutes_late?: number
          notes?: string | null
          status?: string
          updated_at?: string
          user_id: string
          working_hours?: number | null
        }
        Update: {
          clock_in?: string | null
          clock_in_lat?: number | null
          clock_in_lng?: number | null
          clock_out?: string | null
          clock_out_lat?: number | null
          clock_out_lng?: number | null
          created_at?: string
          date?: string
          id?: string
          minutes_late?: number
          notes?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          working_hours?: number | null
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
      card_points: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          expires_at: string | null
          id: string
          is_expired: boolean
          notes: string | null
          points: number
          transaction_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          expires_at?: string | null
          id?: string
          is_expired?: boolean
          notes?: string | null
          points: number
          transaction_type?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          expires_at?: string | null
          id?: string
          is_expired?: boolean
          notes?: string | null
          points?: number
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_points_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "elite_customers"
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
      chat_channel_members: {
        Row: {
          channel_id: string
          id: string
          joined_at: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          id?: string
          joined_at?: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          id?: string
          joined_at?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channels: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean
          kind: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          kind?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          kind?: string
          name?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          body: string
          channel_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          file_url: string | null
          files: Json
          id: string
          parent_message_id: string | null
          pinned: boolean
          sender_id: string
        }
        Insert: {
          body?: string
          channel_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          file_url?: string | null
          files?: Json
          id?: string
          parent_message_id?: string | null
          pinned?: boolean
          sender_id: string
        }
        Update: {
          body?: string
          channel_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          file_url?: string | null
          files?: Json
          id?: string
          parent_message_id?: string | null
          pinned?: boolean
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_moderation_log: {
        Row: {
          action: string
          channel_id: string | null
          created_at: string
          id: string
          moderator_id: string
          reason: string | null
          target_message_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          channel_id?: string | null
          created_at?: string
          id?: string
          moderator_id: string
          reason?: string | null
          target_message_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          channel_id?: string | null
          created_at?: string
          id?: string
          moderator_id?: string
          reason?: string | null
          target_message_id?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_moderation_log_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_moderation_log_target_message_id_fkey"
            columns: ["target_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      company_purchases: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          grand_total: number
          gst_total: number
          id: string
          notes: string | null
          pdf_url: string | null
          purchase_date: string
          purchase_number: string | null
          status: string
          subtotal: number
          supplier_invoice_no: string
          supplier_name: string
          tally_exported_at: string | null
          tally_import_status: string
          updated_at: string
          voucher_class: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          grand_total?: number
          gst_total?: number
          id?: string
          notes?: string | null
          pdf_url?: string | null
          purchase_date: string
          purchase_number?: string | null
          status?: string
          subtotal?: number
          supplier_invoice_no: string
          supplier_name: string
          tally_exported_at?: string | null
          tally_import_status?: string
          updated_at?: string
          voucher_class?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          grand_total?: number
          gst_total?: number
          id?: string
          notes?: string | null
          pdf_url?: string | null
          purchase_date?: string
          purchase_number?: string | null
          status?: string
          subtotal?: number
          supplier_invoice_no?: string
          supplier_name?: string
          tally_exported_at?: string | null
          tally_import_status?: string
          updated_at?: string
          voucher_class?: string
        }
        Relationships: []
      }
      customer_dues: {
        Row: {
          amount: number
          cleared_at: string | null
          cleared_by: string | null
          created_at: string
          customer_name: string
          customer_phone: string
          description: string | null
          due_type: string | null
          id: string
          is_cleared: boolean
          reference_id: string | null
        }
        Insert: {
          amount?: number
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          customer_name: string
          customer_phone: string
          description?: string | null
          due_type?: string | null
          id?: string
          is_cleared?: boolean
          reference_id?: string | null
        }
        Update: {
          amount?: number
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          customer_name?: string
          customer_phone?: string
          description?: string | null
          due_type?: string | null
          id?: string
          is_cleared?: boolean
          reference_id?: string | null
        }
        Relationships: []
      }
      customer_feedback: {
        Row: {
          comments: string | null
          created_at: string
          customer_name: string
          customer_phone: string
          id: string
          lead_created: boolean
          lead_id: string | null
          needs_attention: boolean
          overall_rating: number
          qualified_for_review: boolean
          reviewed_on_google: boolean
          salesperson_name: string | null
          showroom_id: string
          staff_rating: number
          thank_you_sent: boolean
          thank_you_sent_at: string | null
          thank_you_template: string | null
        }
        Insert: {
          comments?: string | null
          created_at?: string
          customer_name: string
          customer_phone: string
          id?: string
          lead_created?: boolean
          lead_id?: string | null
          needs_attention?: boolean
          overall_rating: number
          qualified_for_review?: boolean
          reviewed_on_google?: boolean
          salesperson_name?: string | null
          showroom_id?: string
          staff_rating: number
          thank_you_sent?: boolean
          thank_you_sent_at?: string | null
          thank_you_template?: string | null
        }
        Update: {
          comments?: string | null
          created_at?: string
          customer_name?: string
          customer_phone?: string
          id?: string
          lead_created?: boolean
          lead_id?: string | null
          needs_attention?: boolean
          overall_rating?: number
          qualified_for_review?: boolean
          reviewed_on_google?: boolean
          salesperson_name?: string | null
          showroom_id?: string
          staff_rating?: number
          thank_you_sent?: boolean
          thank_you_sent_at?: string | null
          thank_you_template?: string | null
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
      display_inventory: {
        Row: {
          id: string
          last_updated: string
          product_id: string
          quantity_on_display: number
        }
        Insert: {
          id?: string
          last_updated?: string
          product_id: string
          quantity_on_display?: number
        }
        Update: {
          id?: string
          last_updated?: string
          product_id?: string
          quantity_on_display?: number
        }
        Relationships: [
          {
            foreignKeyName: "display_inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "inventory_products"
            referencedColumns: ["id"]
          },
        ]
      }
      elite_customers: {
        Row: {
          app_activated: boolean
          card_enrollment_date: string | null
          card_expiry_date: string | null
          card_issue_date: string
          card_number: string | null
          card_tier: string
          created_at: string
          created_by: string | null
          current_points: number
          customer_name: string
          date_of_birth: string | null
          id: string
          lead_id: string | null
          lifetime_points: number
          notes: string | null
          phone_1: string
          phone_2: string | null
          referral_code: string | null
          status: string
          updated_at: string
        }
        Insert: {
          app_activated?: boolean
          card_enrollment_date?: string | null
          card_expiry_date?: string | null
          card_issue_date?: string
          card_number?: string | null
          card_tier?: string
          created_at?: string
          created_by?: string | null
          current_points?: number
          customer_name: string
          date_of_birth?: string | null
          id?: string
          lead_id?: string | null
          lifetime_points?: number
          notes?: string | null
          phone_1: string
          phone_2?: string | null
          referral_code?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          app_activated?: boolean
          card_enrollment_date?: string | null
          card_expiry_date?: string | null
          card_issue_date?: string
          card_number?: string | null
          card_tier?: string
          created_at?: string
          created_by?: string | null
          current_points?: number
          customer_name?: string
          date_of_birth?: string | null
          id?: string
          lead_id?: string | null
          lifetime_points?: number
          notes?: string | null
          phone_1?: string
          phone_2?: string | null
          referral_code?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      godrej_products: {
        Row: {
          active: boolean
          category: string
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          name: string
          price: string | null
          price_numeric: number | null
          product_code: string | null
          product_url: string
          scraped_at: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
          price?: string | null
          price_numeric?: number | null
          product_code?: string | null
          product_url: string
          scraped_at?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          price?: string | null
          price_numeric?: number | null
          product_code?: string | null
          product_url?: string
          scraped_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      godrej_scrape_runs: {
        Row: {
          categories_processed: number
          details: Json | null
          error_message: string | null
          finished_at: string | null
          id: string
          mode: string
          products_skipped: number
          products_upserted: number
          started_at: string
          status: string
          urls_discovered: number
        }
        Insert: {
          categories_processed?: number
          details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          products_skipped?: number
          products_upserted?: number
          started_at?: string
          status?: string
          urls_discovered?: number
        }
        Update: {
          categories_processed?: number
          details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          products_skipped?: number
          products_upserted?: number
          started_at?: string
          status?: string
          urls_discovered?: number
        }
        Relationships: []
      }
      hde_display_items: {
        Row: {
          created_at: string
          display_status: string
          id: string
          location_id: string
          notes: string | null
          order_id: string | null
          product_id: string
          replacement_product_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          display_status?: string
          id?: string
          location_id: string
          notes?: string | null
          order_id?: string | null
          product_id: string
          replacement_product_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          display_status?: string
          id?: string
          location_id?: string
          notes?: string | null
          order_id?: string | null
          product_id?: string
          replacement_product_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_display_items_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "hde_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hde_display_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "hde_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hde_display_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hde_display_items_replacement_product_id_fkey"
            columns: ["replacement_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      hde_inventory: {
        Row: {
          group_id: string | null
          id: string
          inventory_type: string
          location_id: string
          product_id: string
          quantity: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          group_id?: string | null
          id?: string
          inventory_type: string
          location_id: string
          product_id: string
          quantity?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          group_id?: string | null
          id?: string
          inventory_type?: string
          location_id?: string
          product_id?: string
          quantity?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hde_inventory_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "hde_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hde_inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      hde_job_photos: {
        Row: {
          id: string
          lat: number | null
          lng: number | null
          order_id: string
          photo_type: string
          photo_url: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          id?: string
          lat?: number | null
          lng?: number | null
          order_id: string
          photo_type: string
          photo_url: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          id?: string
          lat?: number | null
          lng?: number | null
          order_id?: string
          photo_type?: string
          photo_url?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hde_job_photos_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "hde_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      hde_locations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          type?: string
        }
        Relationships: []
      }
      hde_order_timeline: {
        Row: {
          action: string
          description: string | null
          id: string
          new_value: string | null
          old_value: string | null
          order_id: string
          performed_at: string
          performed_by: string | null
        }
        Insert: {
          action: string
          description?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          order_id: string
          performed_at?: string
          performed_by?: string | null
        }
        Update: {
          action?: string
          description?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          order_id?: string
          performed_at?: string
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hde_order_timeline_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "hde_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      hde_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          company_order_reason: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string
          custom_specs: string | null
          customer_name: string | null
          customer_phone: string | null
          display_item_id: string | null
          due_date: string | null
          field_assigned_at: string | null
          field_assigned_to: string | null
          id: string
          lead_id: string | null
          location_id: string | null
          notes: string | null
          order_number: string
          order_tag: string | null
          order_type: string
          product_id: string
          qty_sold: number | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          replacement_product_id: string | null
          service_assigned_at: string | null
          service_assigned_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          company_order_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by: string
          custom_specs?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          display_item_id?: string | null
          due_date?: string | null
          field_assigned_at?: string | null
          field_assigned_to?: string | null
          id?: string
          lead_id?: string | null
          location_id?: string | null
          notes?: string | null
          order_number: string
          order_tag?: string | null
          order_type: string
          product_id: string
          qty_sold?: number | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          replacement_product_id?: string | null
          service_assigned_at?: string | null
          service_assigned_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          company_order_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string
          custom_specs?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          display_item_id?: string | null
          due_date?: string | null
          field_assigned_at?: string | null
          field_assigned_to?: string | null
          id?: string
          lead_id?: string | null
          location_id?: string | null
          notes?: string | null
          order_number?: string
          order_tag?: string | null
          order_type?: string
          product_id?: string
          qty_sold?: number | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          replacement_product_id?: string | null
          service_assigned_at?: string | null
          service_assigned_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hde_orders_display_item_id_fkey"
            columns: ["display_item_id"]
            isOneToOne: false
            referencedRelation: "hde_display_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hde_orders_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hde_orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "hde_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hde_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hde_orders_replacement_product_id_fkey"
            columns: ["replacement_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      hde_product_photos: {
        Row: {
          id: string
          photo_url: string
          product_id: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          id?: string
          photo_url: string
          product_id: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          id?: string
          photo_url?: string
          product_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hde_product_photos_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_audit_log: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          id: string
          lead_id: string | null
          location_id: string | null
          product_id: string
          quantity_change: number
          reason: string | null
          service_job_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string | null
          location_id?: string | null
          product_id: string
          quantity_change: number
          reason?: string | null
          service_job_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string | null
          location_id?: string | null
          product_id?: string
          quantity_change?: number
          reason?: string | null
          service_job_id?: string | null
        }
        Relationships: []
      }
      inventory_products: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          photo_url: string | null
          reorder_threshold: number
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          photo_url?: string | null
          reorder_threshold?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          photo_url?: string | null
          reorder_threshold?: number
          updated_at?: string
        }
        Relationships: []
      }
      invite_tokens: {
        Row: {
          created_at: string
          customer_id: string
          expires_at: string
          id: string
          phone: string
          redeemed_user_id: string | null
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          expires_at: string
          id?: string
          phone: string
          redeemed_user_id?: string | null
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          expires_at?: string
          id?: string
          phone?: string
          redeemed_user_id?: string | null
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invite_tokens_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "elite_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_visit_locations: {
        Row: {
          active: boolean
          charge: number
          created_at: string
          id: string
          location_name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          charge: number
          created_at?: string
          id?: string
          location_name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          charge?: number
          created_at?: string
          id?: string
          location_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      lead_alerts: {
        Row: {
          alert_type: string
          created_at: string
          id: string
          lead_id: string
          message: string
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          id?: string
          lead_id: string
          message: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          id?: string
          lead_id?: string
          message?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
        }
        Relationships: []
      }
      lead_assignment_history: {
        Row: {
          assigned_by: string | null
          created_at: string
          from_user: string | null
          id: string
          lead_id: string
          reason: string | null
          to_user: string | null
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          from_user?: string | null
          id?: string
          lead_id: string
          reason?: string | null
          to_user?: string | null
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          from_user?: string | null
          id?: string
          lead_id?: string
          reason?: string | null
          to_user?: string | null
        }
        Relationships: []
      }
      lead_deduplication_log: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          customer_phone: string
          feedback_id: string | null
          id: string
          last_visit_date: string | null
          lead_id: string
          notes: string | null
          source: string | null
          visit_count: number | null
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          customer_phone: string
          feedback_id?: string | null
          id?: string
          last_visit_date?: string | null
          lead_id: string
          notes?: string | null
          source?: string | null
          visit_count?: number | null
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          customer_phone?: string
          feedback_id?: string | null
          id?: string
          last_visit_date?: string | null
          lead_id?: string
          notes?: string | null
          source?: string | null
          visit_count?: number | null
        }
        Relationships: []
      }
      lead_journey_history: {
        Row: {
          auto: boolean
          changed_at: string
          changed_by: string | null
          from_stage: string | null
          id: string
          lead_id: string
          reason: string | null
          to_stage: string
        }
        Insert: {
          auto?: boolean
          changed_at?: string
          changed_by?: string | null
          from_stage?: string | null
          id?: string
          lead_id: string
          reason?: string | null
          to_stage: string
        }
        Update: {
          auto?: boolean
          changed_at?: string
          changed_by?: string | null
          from_stage?: string | null
          id?: string
          lead_id?: string
          reason?: string | null
          to_stage?: string
        }
        Relationships: []
      }
      lead_messages: {
        Row: {
          concern: string | null
          created_at: string
          created_by: string | null
          delivered_at: string | null
          error_message: string | null
          failed_at: string | null
          id: string
          intent: string | null
          journey_stage: string | null
          lead_id: string
          length_category: string | null
          message_body: string
          message_kind: string | null
          message_type: string
          provider_message_id: string | null
          read_at: string | null
          response_received: boolean
          sent_at: string
          sentiment: string | null
          sequence_number: number | null
          status: string
          template_id: string | null
          template_used: string | null
          variant: string | null
        }
        Insert: {
          concern?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          intent?: string | null
          journey_stage?: string | null
          lead_id: string
          length_category?: string | null
          message_body: string
          message_kind?: string | null
          message_type: string
          provider_message_id?: string | null
          read_at?: string | null
          response_received?: boolean
          sent_at?: string
          sentiment?: string | null
          sequence_number?: number | null
          status?: string
          template_id?: string | null
          template_used?: string | null
          variant?: string | null
        }
        Update: {
          concern?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          intent?: string | null
          journey_stage?: string | null
          lead_id?: string
          length_category?: string | null
          message_body?: string
          message_kind?: string | null
          message_type?: string
          provider_message_id?: string | null
          read_at?: string | null
          response_received?: boolean
          sent_at?: string
          sentiment?: string | null
          sequence_number?: number | null
          status?: string
          template_id?: string | null
          template_used?: string | null
          variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
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
          assigned_at: string | null
          assigned_to: string | null
          assignment_notes: string | null
          barrier_addressed: boolean
          budget_range: string | null
          category: Database["public"]["Enums"]["lead_category"]
          cold_at: string | null
          concern_type: string | null
          conversation_message_count: number
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
          dead_lead: boolean
          decision_timeline: string | null
          deleted_at: string | null
          deleted_by: string | null
          delivery_assigned_to: string | null
          delivery_date: string | null
          delivery_notes: string | null
          elite_card_id: string | null
          elite_opted_date: string | null
          elite_opted_in: boolean | null
          family_situation: string | null
          family_visit_date: string | null
          feedback_score: number | null
          first_purchase_date: string | null
          has_family: boolean | null
          id: string
          journey_stage: string | null
          journey_stage_auto: boolean
          journey_stage_changed_at: string | null
          last_activity_date: string | null
          last_alert_at: string | null
          last_follow_up: string
          last_inbound_concern: string | null
          last_inbound_intent: string | null
          last_inbound_sentiment: string | null
          last_message_at: string | null
          last_payment_link_sent_at: string | null
          last_purchase_date: string | null
          last_recommended_message_type: string | null
          last_response_at: string | null
          liked_product: string | null
          messages_sent: number
          needs_personal_call: boolean
          neighborhood: string | null
          next_action_suggested: string | null
          next_follow_up_date: string | null
          next_follow_up_time: string | null
          notes: string | null
          objection_type: string | null
          orders: Json
          preferred_style: string | null
          price_sensitivity: string | null
          product_viewed: string | null
          products_viewed: Json | null
          repeat_count: number
          repeat_customer: boolean
          response_time_minutes: number | null
          score_breakdown: Json | null
          source: string
          source_type: string | null
          stage_changed_at: string | null
          stated_need: string | null
          status: Database["public"]["Enums"]["lead_status"]
          total_sales: number
          unanswered_outbound_count: number
          updated_at: string
          updated_by: string
          value_in_rupees: number
          visit_count: number
          visit_date: string | null
          visit_photo: string | null
          why_lost: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          assignment_notes?: string | null
          barrier_addressed?: boolean
          budget_range?: string | null
          category: Database["public"]["Enums"]["lead_category"]
          cold_at?: string | null
          concern_type?: string | null
          conversation_message_count?: number
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
          dead_lead?: boolean
          decision_timeline?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          delivery_assigned_to?: string | null
          delivery_date?: string | null
          delivery_notes?: string | null
          elite_card_id?: string | null
          elite_opted_date?: string | null
          elite_opted_in?: boolean | null
          family_situation?: string | null
          family_visit_date?: string | null
          feedback_score?: number | null
          first_purchase_date?: string | null
          has_family?: boolean | null
          id?: string
          journey_stage?: string | null
          journey_stage_auto?: boolean
          journey_stage_changed_at?: string | null
          last_activity_date?: string | null
          last_alert_at?: string | null
          last_follow_up?: string
          last_inbound_concern?: string | null
          last_inbound_intent?: string | null
          last_inbound_sentiment?: string | null
          last_message_at?: string | null
          last_payment_link_sent_at?: string | null
          last_purchase_date?: string | null
          last_recommended_message_type?: string | null
          last_response_at?: string | null
          liked_product?: string | null
          messages_sent?: number
          needs_personal_call?: boolean
          neighborhood?: string | null
          next_action_suggested?: string | null
          next_follow_up_date?: string | null
          next_follow_up_time?: string | null
          notes?: string | null
          objection_type?: string | null
          orders?: Json
          preferred_style?: string | null
          price_sensitivity?: string | null
          product_viewed?: string | null
          products_viewed?: Json | null
          repeat_count?: number
          repeat_customer?: boolean
          response_time_minutes?: number | null
          score_breakdown?: Json | null
          source?: string
          source_type?: string | null
          stage_changed_at?: string | null
          stated_need?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          total_sales?: number
          unanswered_outbound_count?: number
          updated_at?: string
          updated_by: string
          value_in_rupees?: number
          visit_count?: number
          visit_date?: string | null
          visit_photo?: string | null
          why_lost?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          assignment_notes?: string | null
          barrier_addressed?: boolean
          budget_range?: string | null
          category?: Database["public"]["Enums"]["lead_category"]
          cold_at?: string | null
          concern_type?: string | null
          conversation_message_count?: number
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
          dead_lead?: boolean
          decision_timeline?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          delivery_assigned_to?: string | null
          delivery_date?: string | null
          delivery_notes?: string | null
          elite_card_id?: string | null
          elite_opted_date?: string | null
          elite_opted_in?: boolean | null
          family_situation?: string | null
          family_visit_date?: string | null
          feedback_score?: number | null
          first_purchase_date?: string | null
          has_family?: boolean | null
          id?: string
          journey_stage?: string | null
          journey_stage_auto?: boolean
          journey_stage_changed_at?: string | null
          last_activity_date?: string | null
          last_alert_at?: string | null
          last_follow_up?: string
          last_inbound_concern?: string | null
          last_inbound_intent?: string | null
          last_inbound_sentiment?: string | null
          last_message_at?: string | null
          last_payment_link_sent_at?: string | null
          last_purchase_date?: string | null
          last_recommended_message_type?: string | null
          last_response_at?: string | null
          liked_product?: string | null
          messages_sent?: number
          needs_personal_call?: boolean
          neighborhood?: string | null
          next_action_suggested?: string | null
          next_follow_up_date?: string | null
          next_follow_up_time?: string | null
          notes?: string | null
          objection_type?: string | null
          orders?: Json
          preferred_style?: string | null
          price_sensitivity?: string | null
          product_viewed?: string | null
          products_viewed?: Json | null
          repeat_count?: number
          repeat_customer?: boolean
          response_time_minutes?: number | null
          score_breakdown?: Json | null
          source?: string
          source_type?: string | null
          stage_changed_at?: string | null
          stated_need?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          total_sales?: number
          unanswered_outbound_count?: number
          updated_at?: string
          updated_by?: string
          value_in_rupees?: number
          visit_count?: number
          visit_date?: string | null
          visit_photo?: string | null
          why_lost?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_elite_card_id_fkey"
            columns: ["elite_card_id"]
            isOneToOne: false
            referencedRelation: "elite_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      login_banners: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          end_date: string | null
          id: string
          image_url: string
          link_url: string | null
          sort_order: number
          start_date: string | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          image_url: string
          link_url?: string | null
          sort_order?: number
          start_date?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          image_url?: string
          link_url?: string | null
          sort_order?: number
          start_date?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      logistics_calculations: {
        Row: {
          attached_to_lead: boolean
          breakdown: Json
          calculator_type: string
          created_at: string
          created_by: string
          customer_name: string | null
          customer_phone: string | null
          final_amount: number
          gst_amount: number
          gst_included: boolean
          id: string
          inputs: Json
          lead_id: string | null
          notes: string | null
          subtotal: number
          updated_at: string
        }
        Insert: {
          attached_to_lead?: boolean
          breakdown?: Json
          calculator_type: string
          created_at?: string
          created_by: string
          customer_name?: string | null
          customer_phone?: string | null
          final_amount?: number
          gst_amount?: number
          gst_included?: boolean
          id?: string
          inputs?: Json
          lead_id?: string | null
          notes?: string | null
          subtotal?: number
          updated_at?: string
        }
        Update: {
          attached_to_lead?: boolean
          breakdown?: Json
          calculator_type?: string
          created_at?: string
          created_by?: string
          customer_name?: string | null
          customer_phone?: string | null
          final_amount?: number
          gst_amount?: number
          gst_included?: boolean
          id?: string
          inputs?: Json
          lead_id?: string | null
          notes?: string | null
          subtotal?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "logistics_calculations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_rates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          rate_key: string
          rate_value: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          rate_key: string
          rate_value: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          rate_key?: string
          rate_value?: number
          updated_at?: string
          updated_by?: string | null
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
          provider_message_id: string | null
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
          provider_message_id?: string | null
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
          provider_message_id?: string | null
          recipient_name?: string | null
          recipient_user_id?: string | null
          retry_count?: number
          sent_at?: string | null
          status?: string
        }
        Relationships: []
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reads: {
        Row: {
          channel_id: string
          id: string
          message_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          id?: string
          message_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          id?: string
          message_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reads_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_template_variants: {
        Row: {
          body: string
          created_at: string
          id: string
          is_active: boolean
          reply_count: number
          sent_count: number
          template_id: string
          updated_at: string
          variant_label: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_active?: boolean
          reply_count?: number
          sent_count?: number
          template_id: string
          updated_at?: string
          variant_label: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_active?: boolean
          reply_count?: number
          sent_count?: number
          template_id?: string
          updated_at?: string
          variant_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_template_variants_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          sort_order: number
          stage: string
          title: string
          updated_at: string
          variables: string[]
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          sort_order?: number
          stage: string
          title: string
          updated_at?: string
          variables?: string[]
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          sort_order?: number
          stage?: string
          title?: string
          updated_at?: string
          variables?: string[]
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
      pending_display: {
        Row: {
          date_marked: string
          id: string
          product_id: string
          quantity_pending: number
        }
        Insert: {
          date_marked?: string
          id?: string
          product_id: string
          quantity_pending?: number
        }
        Update: {
          date_marked?: string
          id?: string
          product_id?: string
          quantity_pending?: number
        }
        Relationships: [
          {
            foreignKeyName: "pending_display_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "inventory_products"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_thank_you_messages: {
        Row: {
          created_at: string
          error_message: string | null
          feedback_id: string
          id: string
          message: string
          phone: string
          scheduled_send_time: string
          sent_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          feedback_id: string
          id?: string
          message: string
          phone: string
          scheduled_send_time?: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          feedback_id?: string
          id?: string
          message?: string
          phone?: string
          scheduled_send_time?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_thank_you_messages_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "customer_feedback"
            referencedColumns: ["id"]
          },
        ]
      }
      pinned_messages: {
        Row: {
          channel_id: string
          id: string
          message_id: string
          pinned_at: string
          pinned_by: string
        }
        Insert: {
          channel_id: string
          id?: string
          message_id: string
          pinned_at?: string
          pinned_by: string
        }
        Update: {
          channel_id?: string
          id?: string
          message_id?: string
          pinned_at?: string
          pinned_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "pinned_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pinned_messages_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
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
      purchase_line_items: {
        Row: {
          amount: number
          created_at: string
          discount_percent: number
          gst_amount: number
          gst_percent: number
          hsn_code: string | null
          id: string
          item_code: string | null
          item_name: string
          line_total: number
          no_of_packings: number | null
          purchase_id: string
          quantity: number
          rate: number
          sort_order: number
          unit: string
        }
        Insert: {
          amount?: number
          created_at?: string
          discount_percent?: number
          gst_amount?: number
          gst_percent?: number
          hsn_code?: string | null
          id?: string
          item_code?: string | null
          item_name: string
          line_total?: number
          no_of_packings?: number | null
          purchase_id: string
          quantity?: number
          rate?: number
          sort_order?: number
          unit?: string
        }
        Update: {
          amount?: number
          created_at?: string
          discount_percent?: number
          gst_amount?: number
          gst_percent?: number
          hsn_code?: string | null
          id?: string
          item_code?: string | null
          item_name?: string
          line_total?: number
          no_of_packings?: number | null
          purchase_id?: string
          quantity?: number
          rate?: number
          sort_order?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_line_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "company_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      redemption_requests: {
        Row: {
          customer_id: string
          id: string
          notes: string | null
          points_requested: number
          processed_at: string | null
          processed_by: string | null
          requested_at: string
          rupee_value: number
          status: string
        }
        Insert: {
          customer_id: string
          id?: string
          notes?: string | null
          points_requested: number
          processed_at?: string | null
          processed_by?: string | null
          requested_at?: string
          rupee_value?: number
          status?: string
        }
        Update: {
          customer_id?: string
          id?: string
          notes?: string | null
          points_requested?: number
          processed_at?: string | null
          processed_by?: string | null
          requested_at?: string
          rupee_value?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "redemption_requests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "elite_customers"
            referencedColumns: ["id"]
          },
        ]
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
      scheme_banners: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          image_url: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          image_url: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      service_jobs: {
        Row: {
          accepted_at: string | null
          accounts_approval_status: string | null
          accounts_approved_at: string | null
          accounts_approved_by: string | null
          accounts_notes: string | null
          accounts_rejection_reason: string | null
          address: string
          agent_reached_at: string | null
          amount_paid: number | null
          amount_pending: number | null
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
          inventory_product_id: string | null
          invoice_date: string | null
          invoice_number: string | null
          is_foc: boolean
          location_lat: number | null
          location_lng: number | null
          payment_notes: string | null
          payment_status: string | null
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
          accounts_approval_status?: string | null
          accounts_approved_at?: string | null
          accounts_approved_by?: string | null
          accounts_notes?: string | null
          accounts_rejection_reason?: string | null
          address?: string
          agent_reached_at?: string | null
          amount_paid?: number | null
          amount_pending?: number | null
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
          inventory_product_id?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          is_foc?: boolean
          location_lat?: number | null
          location_lng?: number | null
          payment_notes?: string | null
          payment_status?: string | null
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
          accounts_approval_status?: string | null
          accounts_approved_at?: string | null
          accounts_approved_by?: string | null
          accounts_notes?: string | null
          accounts_rejection_reason?: string | null
          address?: string
          agent_reached_at?: string | null
          amount_paid?: number | null
          amount_pending?: number | null
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
          inventory_product_id?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          is_foc?: boolean
          location_lat?: number | null
          location_lng?: number | null
          payment_notes?: string | null
          payment_status?: string | null
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
            foreignKeyName: "service_jobs_inventory_product_id_fkey"
            columns: ["inventory_product_id"]
            isOneToOne: false
            referencedRelation: "inventory_products"
            referencedColumns: ["id"]
          },
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
      staff_profiles: {
        Row: {
          address: string | null
          bio: string | null
          city: string | null
          created_at: string
          date_of_birth: string | null
          department: string | null
          designation: string | null
          email: string
          full_name: string
          id: string
          is_profile_complete: boolean
          joining_date: string | null
          phone: string | null
          pincode: string | null
          profile_picture_url: string | null
          state: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          date_of_birth?: string | null
          department?: string | null
          designation?: string | null
          email: string
          full_name: string
          id?: string
          is_profile_complete?: boolean
          joining_date?: string | null
          phone?: string | null
          pincode?: string | null
          profile_picture_url?: string | null
          state?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          date_of_birth?: string | null
          department?: string | null
          designation?: string | null
          email?: string
          full_name?: string
          id?: string
          is_profile_complete?: boolean
          joining_date?: string | null
          phone?: string | null
          pincode?: string | null
          profile_picture_url?: string | null
          state?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          gstin: string | null
          id: string
          is_active: boolean
          name: string
          tally_ledger_name: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          name: string
          tally_ledger_name?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          name?: string
          tally_ledger_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_presence: {
        Row: {
          last_activity: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          last_activity?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          last_activity?: string
          status?: string
          updated_at?: string
          user_id?: string
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
      user_status: {
        Row: {
          away_message: string | null
          is_away: boolean
          is_muted: boolean
          muted_reason: string | null
          muted_until: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          away_message?: string | null
          is_away?: boolean
          is_muted?: boolean
          muted_reason?: string | null
          muted_until?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          away_message?: string | null
          is_away?: boolean
          is_muted?: boolean
          muted_reason?: string | null
          muted_until?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      daily_feedback_stats: {
        Row: {
          avg_experience_rating: number | null
          avg_overall_rating: number | null
          feedback_date: string | null
          five_star_count: number | null
          four_star_count: number | null
          poor_count: number | null
          showroom_id: string | null
          three_star_count: number | null
          total_feedback: number | null
        }
        Relationships: []
      }
      monthly_sales_leaderboard: {
        Row: {
          avg_feedback_score: number | null
          closed_deals: number | null
          designation: string | null
          followups_sent: number | null
          inventory_actions: number | null
          leads_count: number | null
          leads_created: number | null
          month: string | null
          ontime_days: number | null
          overdue_count: number | null
          profile_picture_url: string | null
          qualified_leads: number | null
          rank_position: number | null
          reviews_collected: number | null
          salesperson_name: string | null
          score_attendance: number | null
          score_closed: number | null
          score_entry: number | null
          score_followups: number | null
          score_inventory: number | null
          score_overdue: number | null
          score_reviews: number | null
          score_sales: number | null
          score_updates: number | null
          total_score: number | null
          updates_made: number | null
          user_id: string | null
          won_value: number | null
          working_days: number | null
        }
        Relationships: []
      }
      template_variant_performance: {
        Row: {
          is_active: boolean | null
          reply_count: number | null
          reply_rate_pct: number | null
          sent_count: number | null
          stage: string | null
          template_id: string | null
          template_title: string | null
          variant_id: string | null
          variant_label: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_template_variants_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      unified_products: {
        Row: {
          active: boolean | null
          category: string | null
          description: string | null
          id: string | null
          image_url: string | null
          name: string | null
          price: string | null
          price_numeric: number | null
          product_code: string | null
          product_url: string | null
          scraped_at: string | null
          source: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _invoke_daily_excel_report: { Args: never; Returns: number }
      attendance_auto_clockout: { Args: never; Returns: number }
      attendance_clock: {
        Args: { p_action: string; p_lat?: number; p_lng?: number }
        Returns: {
          clock_in: string | null
          clock_in_lat: number | null
          clock_in_lng: number | null
          clock_out: string | null
          clock_out_lat: number | null
          clock_out_lng: number | null
          created_at: string
          date: string
          id: string
          minutes_late: number
          notes: string | null
          status: string
          updated_at: string
          user_id: string
          working_hours: number | null
        }
        SetofOptions: {
          from: "*"
          to: "attendance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attendance_monthly_report: {
        Args: { p_month: string }
        Returns: {
          clock_in: string
          clock_out: string
          date: string
          email: string
          minutes_late: number
          name: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          user_id: string
          working_hours: number
        }[]
      }
      attendance_monthly_user_summary: {
        Args: { p_month: string; p_user_id?: string }
        Returns: {
          days_absent: number
          days_late: number
          days_on_time: number
          days_present: number
          email: string
          name: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
          working_days: number
        }[]
      }
      attendance_today_summary: {
        Args: never
        Returns: {
          clock_in: string
          clock_out: string
          email: string
          minutes_late: number
          name: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          user_id: string
          working_hours: number
        }[]
      }
      bump_variant_reply: { Args: { _variant_id: string }; Returns: undefined }
      bump_variant_sent: { Args: { _variant_id: string }; Returns: undefined }
      calculate_conversion_probability: {
        Args: { _lead_id: string }
        Returns: number
      }
      calculate_score_breakdown: { Args: { _lead_id: string }; Returns: Json }
      check_customer_dues: {
        Args: { p_customer_phone: string }
        Returns: {
          due_count: number
          dues_list: Json
          has_dues: boolean
          total_pending: number
        }[]
      }
      detect_journey_stage: { Args: { _lead_id: string }; Returns: string }
      ensure_default_chat_channels: {
        Args: { _user: string }
        Returns: undefined
      }
      generate_hde_order_number: { Args: never; Returns: string }
      get_chat_directory: {
        Args: never
        Returns: {
          email: string
          id: string
          name: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      get_dashboard_summary: { Args: never; Returns: Json }
      get_lead_owners_for_jobs: {
        Args: { p_job_ids: string[] }
        Returns: {
          assignee_id: string
          assignee_name: string
          job_id: string
          lead_id: string
          owner_id: string
          owner_name: string
        }[]
      }
      get_loyalty_customer_id: { Args: { _uid: string }; Returns: string }
      get_or_create_dm_channel: { Args: { _other: string }; Returns: string }
      get_pending_approvals_count: { Args: never; Returns: number }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_chat_access: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_chat_member: {
        Args: { _channel: string; _user: string }
        Returns: boolean
      }
      is_loyalty_app_user: { Args: { _uid: string }; Returns: boolean }
      link_loyalty_app_user: { Args: { _phone: string }; Returns: string }
      verify_daily_report_secret: { Args: { _token: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "admin"
        | "sales"
        | "service_head"
        | "field_agent"
        | "site_agent"
        | "accounts"
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
        | "kiosk"
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
        | "pending_accounts_approval"
        | "accounts_rejected"
      service_job_type: "service" | "delivery" | "self_delivery"
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
      app_role: [
        "admin",
        "sales",
        "service_head",
        "field_agent",
        "site_agent",
        "accounts",
      ],
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
        "kiosk",
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
        "pending_accounts_approval",
        "accounts_rejected",
      ],
      service_job_type: ["service", "delivery", "self_delivery"],
    },
  },
} as const
