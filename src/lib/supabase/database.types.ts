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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      ad_creatives: {
        Row: {
          ad_id: string
          ad_type: string | null
          client_id: string
          content_type: string | null
          copied_at: string | null
          copy_error: string | null
          external_account_id: string
          id: string
          manual_post_link: string | null
          manual_post_link_at: string | null
          manual_post_link_by: string | null
          platform: Database["public"]["Enums"]["platform"]
          preview_link: string | null
          seen_at: string
          source_url: string | null
          storage_path: string | null
          text_ad: Json | null
        }
        Insert: {
          ad_id: string
          ad_type?: string | null
          client_id: string
          content_type?: string | null
          copied_at?: string | null
          copy_error?: string | null
          external_account_id: string
          id?: string
          manual_post_link?: string | null
          manual_post_link_at?: string | null
          manual_post_link_by?: string | null
          platform: Database["public"]["Enums"]["platform"]
          preview_link?: string | null
          seen_at?: string
          source_url?: string | null
          storage_path?: string | null
          text_ad?: Json | null
        }
        Update: {
          ad_id?: string
          ad_type?: string | null
          client_id?: string
          content_type?: string | null
          copied_at?: string | null
          copy_error?: string | null
          external_account_id?: string
          id?: string
          manual_post_link?: string | null
          manual_post_link_at?: string | null
          manual_post_link_by?: string | null
          platform?: Database["public"]["Enums"]["platform"]
          preview_link?: string | null
          seen_at?: string
          source_url?: string | null
          storage_path?: string | null
          text_ad?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_creatives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_creatives_manual_post_link_by_fkey"
            columns: ["manual_post_link_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_fatigue_snapshots: {
        Row: {
          ad_count: number
          client_id: string
          created_at: string
          data_through: string | null
          id: number
          rows: Json
          snapshot_on: string
        }
        Insert: {
          ad_count: number
          client_id: string
          created_at?: string
          data_through?: string | null
          id?: never
          rows?: Json
          snapshot_on: string
        }
        Update: {
          ad_count?: number
          client_id?: string
          created_at?: string
          data_through?: string | null
          id?: never
          rows?: Json
          snapshot_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_fatigue_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_labels: {
        Row: {
          ad_id: string
          audience: string | null
          basis: string
          client_id: string
          confidence: string
          content_type: string
          external_account_id: string
          format: string
          hook: string
          id: string
          input_digest: string
          labelled_at: string
          model: string
          offer: string
          platform: Database["public"]["Enums"]["platform"]
          summary: string | null
          topic: string | null
        }
        Insert: {
          ad_id: string
          audience?: string | null
          basis: string
          client_id: string
          confidence: string
          content_type: string
          external_account_id: string
          format: string
          hook: string
          id?: string
          input_digest: string
          labelled_at?: string
          model: string
          offer: string
          platform: Database["public"]["Enums"]["platform"]
          summary?: string | null
          topic?: string | null
        }
        Update: {
          ad_id?: string
          audience?: string | null
          basis?: string
          client_id?: string
          confidence?: string
          content_type?: string
          external_account_id?: string
          format?: string
          hook?: string
          id?: string
          input_digest?: string
          labelled_at?: string
          model?: string
          offer?: string
          platform?: Database["public"]["Enums"]["platform"]
          summary?: string | null
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_labels_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_naming_conventions: {
        Row: {
          client_id: string
          created_at: string
          examples: string[]
          id: string
          model: string | null
          names_digest: string
          notes: string | null
          parts: Json
          pattern: string
          platform: string
          separator: string | null
          usage: Json | null
        }
        Insert: {
          client_id: string
          created_at?: string
          examples?: string[]
          id?: string
          model?: string | null
          names_digest: string
          notes?: string | null
          parts?: Json
          pattern: string
          platform: string
          separator?: string | null
          usage?: Json | null
        }
        Update: {
          client_id?: string
          created_at?: string
          examples?: string[]
          id?: string
          model?: string | null
          names_digest?: string
          notes?: string | null
          parts?: Json
          pattern?: string
          platform?: string
          separator?: string | null
          usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_naming_conventions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_playbook_rules: {
        Row: {
          body: string
          check_rule: Json | null
          client_id: string | null
          created_at: string
          created_by: string | null
          id: string
          kind: string
          modes: string[]
          platform: string
          removed_at: string | null
          removed_by: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          check_rule?: Json | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          modes?: string[]
          platform: string
          removed_at?: string | null
          removed_by?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          check_rule?: Json | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          modes?: string[]
          platform?: string
          removed_at?: string | null
          removed_by?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_playbook_rules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_playbook_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_playbook_rules_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_playbooks: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          model: string | null
          period: string
          platform: string
          requested_by: string | null
          sections: Json
          sources: Json
          status: string
          summary: string | null
          usage: Json | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          model?: string | null
          period: string
          platform: string
          requested_by?: string | null
          sections?: Json
          sources?: Json
          status?: string
          summary?: string | null
          usage?: Json | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          model?: string | null
          period?: string
          platform?: string
          requested_by?: string | null
          sections?: Json
          sources?: Json
          status?: string
          summary?: string | null
          usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_playbooks_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_api_connections: {
        Row: {
          connected_at: string
          last_refreshed_at: string | null
          platform: string
          refresh_expires_at: string | null
          updated_at: string
        }
        Insert: {
          connected_at: string
          last_refreshed_at?: string | null
          platform: string
          refresh_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          connected_at?: string
          last_refreshed_at?: string | null
          platform?: string
          refresh_expires_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      breakdown_sync_state: {
        Row: {
          client_id: string
          error: string | null
          external_account_id: string
          kind: string
          source: string
          synced_at: string | null
          synced_through: string | null
        }
        Insert: {
          client_id: string
          error?: string | null
          external_account_id: string
          kind: string
          source: string
          synced_at?: string | null
          synced_through?: string | null
        }
        Update: {
          client_id?: string
          error?: string | null
          external_account_id?: string
          kind?: string
          source?: string
          synced_at?: string | null
          synced_through?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "breakdown_sync_state_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      call_commitment_actions: {
        Row: {
          action: string
          client_id: string
          commitment_id: string
          created_at: string
          id: string
          profile_id: string | null
          reason: string | null
          snooze_until: string | null
          sprint_test_id: string | null
        }
        Insert: {
          action: string
          client_id: string
          commitment_id: string
          created_at?: string
          id?: string
          profile_id?: string | null
          reason?: string | null
          snooze_until?: string | null
          sprint_test_id?: string | null
        }
        Update: {
          action?: string
          client_id?: string
          commitment_id?: string
          created_at?: string
          id?: string
          profile_id?: string | null
          reason?: string | null
          snooze_until?: string | null
          sprint_test_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_commitment_actions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_commitment_actions_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "call_commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_commitment_actions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_commitment_actions_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "recommendation_results"
            referencedColumns: ["test_id"]
          },
          {
            foreignKeyName: "call_commitment_actions_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "sprint_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      call_commitments: {
        Row: {
          acted_at: string | null
          acted_evidence: string | null
          acted_href: string | null
          call_id: string
          checked_at: string | null
          client_id: string
          created_at: string
          detail: string | null
          due_on: string | null
          id: string
          kind: string
          owner_name: string | null
          owner_side: string
          platform: string | null
          quote: string | null
          reminded_at: string | null
          said_on: string
          superseded_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          acted_at?: string | null
          acted_evidence?: string | null
          acted_href?: string | null
          call_id: string
          checked_at?: string | null
          client_id: string
          created_at?: string
          detail?: string | null
          due_on?: string | null
          id?: string
          kind: string
          owner_name?: string | null
          owner_side?: string
          platform?: string | null
          quote?: string | null
          reminded_at?: string | null
          said_on: string
          superseded_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          acted_at?: string | null
          acted_evidence?: string | null
          acted_href?: string | null
          call_id?: string
          checked_at?: string | null
          client_id?: string
          created_at?: string
          detail?: string | null
          due_on?: string | null
          id?: string
          kind?: string
          owner_name?: string | null
          owner_side?: string
          platform?: string | null
          quote?: string | null
          reminded_at?: string | null
          said_on?: string
          superseded_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_commitments_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "client_calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_commitments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_briefs: {
        Row: {
          answers: Json
          archived_at: string | null
          archived_by: string | null
          brief: Json | null
          client_id: string
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          model: string | null
          notes: string | null
          notion_page_id: string | null
          notion_page_url: string | null
          notion_sent_at: string | null
          questions: Json
          request: string
          revision: string | null
          status: string
          updated_at: string
          usage: Json | null
        }
        Insert: {
          answers?: Json
          archived_at?: string | null
          archived_by?: string | null
          brief?: Json | null
          client_id: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          model?: string | null
          notes?: string | null
          notion_page_id?: string | null
          notion_page_url?: string | null
          notion_sent_at?: string | null
          questions?: Json
          request: string
          revision?: string | null
          status?: string
          updated_at?: string
          usage?: Json | null
        }
        Update: {
          answers?: Json
          archived_at?: string | null
          archived_by?: string | null
          brief?: Json | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          model?: string | null
          notes?: string | null
          notion_page_id?: string | null
          notion_page_url?: string | null
          notion_sent_at?: string | null
          questions?: Json
          request?: string
          revision?: string | null
          status?: string
          updated_at?: string
          usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_briefs_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_briefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_briefs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_build_plans: {
        Row: {
          answers: Json
          campaign_build_id: string | null
          client_id: string
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          mode: string
          model: string | null
          plan: Json | null
          platform: string
          preset: string
          proposal: string | null
          questions: Json
          request: string
          sprint_test_id: string | null
          status: string
          updated_at: string
          usage: Json | null
        }
        Insert: {
          answers?: Json
          campaign_build_id?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          mode?: string
          model?: string | null
          plan?: Json | null
          platform: string
          preset: string
          proposal?: string | null
          questions?: Json
          request?: string
          sprint_test_id?: string | null
          status?: string
          updated_at?: string
          usage?: Json | null
        }
        Update: {
          answers?: Json
          campaign_build_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          mode?: string
          model?: string | null
          plan?: Json | null
          platform?: string
          preset?: string
          proposal?: string | null
          questions?: Json
          request?: string
          sprint_test_id?: string | null
          status?: string
          updated_at?: string
          usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_build_plans_campaign_build_id_fkey"
            columns: ["campaign_build_id"]
            isOneToOne: false
            referencedRelation: "campaign_builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_build_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_build_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_build_plans_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "recommendation_results"
            referencedColumns: ["test_id"]
          },
          {
            foreignKeyName: "campaign_build_plans_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "sprint_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_builds: {
        Row: {
          client_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          created_ids: Json
          dry_run_at: string | null
          error: string | null
          external_account_id: string
          id: string
          mode: string
          name: string
          plan_id: string | null
          platform: string
          sent_at: string | null
          spec: Json
          sprint_test_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_ids?: Json
          dry_run_at?: string | null
          error?: string | null
          external_account_id: string
          id?: string
          mode?: string
          name: string
          plan_id?: string | null
          platform: string
          sent_at?: string | null
          spec: Json
          sprint_test_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_ids?: Json
          dry_run_at?: string | null
          error?: string | null
          external_account_id?: string
          id?: string
          mode?: string
          name?: string
          plan_id?: string | null
          platform?: string
          sent_at?: string | null
          spec?: Json
          sprint_test_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_builds_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_builds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_builds_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "campaign_build_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_builds_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "recommendation_results"
            referencedColumns: ["test_id"]
          },
          {
            foreignKeyName: "campaign_builds_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "sprint_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_reads: {
        Row: {
          answer: string
          campaign_id: string
          client_id: string
          created_at: string
          id: string
          model: string | null
          platform: Database["public"]["Enums"]["platform"]
          sources: Json
          usage: Json | null
          week: string
        }
        Insert: {
          answer: string
          campaign_id: string
          client_id: string
          created_at?: string
          id?: string
          model?: string | null
          platform: Database["public"]["Enums"]["platform"]
          sources?: Json
          usage?: Json | null
          week: string
        }
        Update: {
          answer?: string
          campaign_id?: string
          client_id?: string
          created_at?: string
          id?: string
          model?: string | null
          platform?: Database["public"]["Enums"]["platform"]
          sources?: Json
          usage?: Json | null
          week?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_reads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_statuses: {
        Row: {
          campaign_id: string
          campaign_name: string | null
          checked_at: string
          client_id: string
          external_account_id: string
          platform: Database["public"]["Enums"]["platform"]
          status: string
        }
        Insert: {
          campaign_id: string
          campaign_name?: string | null
          checked_at?: string
          client_id: string
          external_account_id: string
          platform: Database["public"]["Enums"]["platform"]
          status: string
        }
        Update: {
          campaign_id?: string
          campaign_name?: string | null
          checked_at?: string
          client_id?: string
          external_account_id?: string
          platform?: Database["public"]["Enums"]["platform"]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_statuses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      change_log: {
        Row: {
          at: string
          changes: Json
          client_id: string | null
          id: number
          label: string | null
          op: string
          profile_id: string
          row_id: string | null
          table_name: string
        }
        Insert: {
          at?: string
          changes?: Json
          client_id?: string | null
          id?: never
          label?: string | null
          op: string
          profile_id: string
          row_id?: string | null
          table_name: string
        }
        Update: {
          at?: string
          changes?: Json
          client_id?: string | null
          id?: never
          label?: string | null
          op?: string
          profile_id?: string
          row_id?: string | null
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_log_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      check_definitions: {
        Row: {
          active: boolean
          cadence: Database["public"]["Enums"]["cadence"]
          flag_immediately_when: string | null
          guide: string | null
          id: string
          instructions: string
          key: string
          name: string
          not_applicable_when: string | null
          owner_role: Database["public"]["Enums"]["team_role"]
          pre_loaded: string | null
          sort_order: number
          what_to_record: string | null
        }
        Insert: {
          active?: boolean
          cadence: Database["public"]["Enums"]["cadence"]
          flag_immediately_when?: string | null
          guide?: string | null
          id?: string
          instructions: string
          key: string
          name: string
          not_applicable_when?: string | null
          owner_role: Database["public"]["Enums"]["team_role"]
          pre_loaded?: string | null
          sort_order?: number
          what_to_record?: string | null
        }
        Update: {
          active?: boolean
          cadence?: Database["public"]["Enums"]["cadence"]
          flag_immediately_when?: string | null
          guide?: string | null
          id?: string
          instructions?: string
          key?: string
          name?: string
          not_applicable_when?: string | null
          owner_role?: Database["public"]["Enums"]["team_role"]
          pre_loaded?: string | null
          sort_order?: number
          what_to_record?: string | null
        }
        Relationships: []
      }
      check_results: {
        Row: {
          auto_data: Json | null
          check_definition_id: string
          check_run_id: string
          checked_at: string | null
          checked_by_profile_id: string | null
          client_id: string
          findings: string | null
          flagged_at: string | null
          flagged_to_profile_id: string | null
          id: string
          notion_action_page_id: string | null
          status: Database["public"]["Enums"]["check_status"] | null
          updated_at: string
        }
        Insert: {
          auto_data?: Json | null
          check_definition_id: string
          check_run_id: string
          checked_at?: string | null
          checked_by_profile_id?: string | null
          client_id: string
          findings?: string | null
          flagged_at?: string | null
          flagged_to_profile_id?: string | null
          id?: string
          notion_action_page_id?: string | null
          status?: Database["public"]["Enums"]["check_status"] | null
          updated_at?: string
        }
        Update: {
          auto_data?: Json | null
          check_definition_id?: string
          check_run_id?: string
          checked_at?: string | null
          checked_by_profile_id?: string | null
          client_id?: string
          findings?: string | null
          flagged_at?: string | null
          flagged_to_profile_id?: string | null
          id?: string
          notion_action_page_id?: string | null
          status?: Database["public"]["Enums"]["check_status"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "check_results_check_definition_id_fkey"
            columns: ["check_definition_id"]
            isOneToOne: false
            referencedRelation: "check_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_results_check_run_id_fkey"
            columns: ["check_run_id"]
            isOneToOne: false
            referencedRelation: "check_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_results_checked_by_profile_id_fkey"
            columns: ["checked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_results_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_results_flagged_to_profile_id_fkey"
            columns: ["flagged_to_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      check_runs: {
        Row: {
          cadence: Database["public"]["Enums"]["cadence"]
          client_id: string
          created_at: string
          id: string
          period_end: string
          period_start: string
        }
        Insert: {
          cadence: Database["public"]["Enums"]["cadence"]
          client_id: string
          created_at?: string
          id?: string
          period_end: string
          period_start: string
        }
        Update: {
          cadence?: Database["public"]["Enums"]["cadence"]
          client_id?: string
          created_at?: string
          id?: string
          period_end?: string
          period_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "check_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_briefs: {
        Row: {
          client_id: string
          content: string | null
          created_at: string
          created_by_profile_id: string | null
          error: string | null
          finished_at: string | null
          id: string
          model: string | null
          source_count: number | null
          source_digest: string | null
          status: string
          usage: Json | null
          written_by: string
        }
        Insert: {
          client_id: string
          content?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          model?: string | null
          source_count?: number | null
          source_digest?: string | null
          status?: string
          usage?: Json | null
          written_by?: string
        }
        Update: {
          client_id?: string
          content?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          model?: string | null
          source_count?: number | null
          source_digest?: string | null
          status?: string
          usage?: Json | null
          written_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_briefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_briefs_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_budgets: {
        Row: {
          amount: number
          campaign_id: string
          client_id: string
          id: string
          month: string
          platform: Database["public"]["Enums"]["platform"]
          updated_at: string
        }
        Insert: {
          amount: number
          campaign_id?: string
          client_id: string
          id?: string
          month: string
          platform: Database["public"]["Enums"]["platform"]
          updated_at?: string
        }
        Update: {
          amount?: number
          campaign_id?: string
          client_id?: string
          id?: string
          month?: string
          platform?: Database["public"]["Enums"]["platform"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_budgets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_calls: {
        Row: {
          call_date: string
          client_id: string
          content: string | null
          content_chars: number | null
          content_digest: string | null
          created_at: string
          created_by_profile_id: string | null
          extract_error: string | null
          extract_status: string
          extracted_at: string | null
          id: string
          last_edited_time: string | null
          notion_page_id: string | null
          notion_status: string | null
          removed_at: string | null
          source: string
          summary: string | null
          synced_at: string | null
          title: string
          updated_at: string
          usage: Json | null
        }
        Insert: {
          call_date: string
          client_id: string
          content?: string | null
          content_chars?: number | null
          content_digest?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          extract_error?: string | null
          extract_status?: string
          extracted_at?: string | null
          id?: string
          last_edited_time?: string | null
          notion_page_id?: string | null
          notion_status?: string | null
          removed_at?: string | null
          source: string
          summary?: string | null
          synced_at?: string | null
          title: string
          updated_at?: string
          usage?: Json | null
        }
        Update: {
          call_date?: string
          client_id?: string
          content?: string | null
          content_chars?: number | null
          content_digest?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          extract_error?: string | null
          extract_status?: string
          extracted_at?: string | null
          id?: string
          last_edited_time?: string | null
          notion_page_id?: string | null
          notion_status?: string | null
          removed_at?: string | null
          source?: string
          summary?: string | null
          synced_at?: string | null
          title?: string
          updated_at?: string
          usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "client_calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_calls_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_competitors: {
        Row: {
          client_id: string
          created_at: string
          created_by_profile_id: string | null
          google_advertiser_ids: string[]
          id: string
          linkedin_advertiser: string | null
          meta_page_id: string | null
          name: string
          notes: string | null
          removed_at: string | null
          removed_by_profile_id: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by_profile_id?: string | null
          google_advertiser_ids?: string[]
          id?: string
          linkedin_advertiser?: string | null
          meta_page_id?: string | null
          name: string
          notes?: string | null
          removed_at?: string | null
          removed_by_profile_id?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by_profile_id?: string | null
          google_advertiser_ids?: string[]
          id?: string
          linkedin_advertiser?: string | null
          meta_page_id?: string | null
          name?: string
          notes?: string | null
          removed_at?: string | null
          removed_by_profile_id?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_competitors_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_competitors_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_competitors_removed_by_profile_id_fkey"
            columns: ["removed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_goal_values: {
        Row: {
          client_id: string
          goal_id: string
          month: string
          target: number | null
          updated_at: string
          updated_by_profile_id: string | null
          value: number
        }
        Insert: {
          client_id: string
          goal_id: string
          month: string
          target?: number | null
          updated_at?: string
          updated_by_profile_id?: string | null
          value: number
        }
        Update: {
          client_id?: string
          goal_id?: string
          month?: string
          target?: number | null
          updated_at?: string
          updated_by_profile_id?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_goal_values_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_goal_values_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "client_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_goal_values_updated_by_profile_id_fkey"
            columns: ["updated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_goals: {
        Row: {
          active: boolean
          client_id: string
          created_at: string
          id: string
          monthly_target: number | null
          name: string
          position: number
        }
        Insert: {
          active?: boolean
          client_id: string
          created_at?: string
          id?: string
          monthly_target?: number | null
          name: string
          position?: number
        }
        Update: {
          active?: boolean
          client_id?: string
          created_at?: string
          id?: string
          monthly_target?: number | null
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_goals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_knowledge: {
        Row: {
          category: string | null
          client_id: string
          content: string | null
          content_chars: number | null
          created_at: string
          created_by_profile_id: string | null
          error: string | null
          file_path: string | null
          file_type: string | null
          id: string
          include: boolean
          last_edited_time: string | null
          notion_collection: string | null
          notion_kind: string | null
          notion_page_id: string | null
          path: string | null
          removed_at: string | null
          source: string
          synced_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          client_id: string
          content?: string | null
          content_chars?: number | null
          created_at?: string
          created_by_profile_id?: string | null
          error?: string | null
          file_path?: string | null
          file_type?: string | null
          id?: string
          include?: boolean
          last_edited_time?: string | null
          notion_collection?: string | null
          notion_kind?: string | null
          notion_page_id?: string | null
          path?: string | null
          removed_at?: string | null
          source: string
          synced_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          client_id?: string
          content?: string | null
          content_chars?: number | null
          created_at?: string
          created_by_profile_id?: string | null
          error?: string | null
          file_path?: string | null
          file_type?: string | null
          id?: string
          include?: boolean
          last_edited_time?: string | null
          notion_collection?: string | null
          notion_kind?: string | null
          notion_page_id?: string | null
          path?: string | null
          removed_at?: string | null
          source?: string
          synced_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_knowledge_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_knowledge_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_platform_accounts: {
        Row: {
          account_name: string | null
          active: boolean
          client_id: string
          conversion_fields: string[]
          created_at: string
          external_account_id: string
          id: string
          kpi_target: number | null
          lead_fields: string[]
          monthly_budget: number | null
          platform: Database["public"]["Enums"]["platform"]
          updated_at: string
          windsor_connector: string
        }
        Insert: {
          account_name?: string | null
          active?: boolean
          client_id: string
          conversion_fields?: string[]
          created_at?: string
          external_account_id: string
          id?: string
          kpi_target?: number | null
          lead_fields?: string[]
          monthly_budget?: number | null
          platform: Database["public"]["Enums"]["platform"]
          updated_at?: string
          windsor_connector: string
        }
        Update: {
          account_name?: string | null
          active?: boolean
          client_id?: string
          conversion_fields?: string[]
          created_at?: string
          external_account_id?: string
          id?: string
          kpi_target?: number | null
          lead_fields?: string[]
          monthly_budget?: number | null
          platform?: Database["public"]["Enums"]["platform"]
          updated_at?: string
          windsor_connector?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_platform_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_team: {
        Row: {
          client_id: string
          profile_id: string
          removed_at: string | null
          role: Database["public"]["Enums"]["team_role"]
        }
        Insert: {
          client_id: string
          profile_id: string
          removed_at?: string | null
          role: Database["public"]["Enums"]["team_role"]
        }
        Update: {
          client_id?: string
          profile_id?: string
          removed_at?: string | null
          role?: Database["public"]["Enums"]["team_role"]
        }
        Relationships: [
          {
            foreignKeyName: "client_team_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_team_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_team_invites: {
        Row: {
          client_id: string
          email: string
          removed_at: string | null
          role: Database["public"]["Enums"]["team_role"]
        }
        Insert: {
          client_id: string
          email: string
          removed_at?: string | null
          role: Database["public"]["Enums"]["team_role"]
        }
        Update: {
          client_id?: string
          email?: string
          removed_at?: string | null
          role?: Database["public"]["Enums"]["team_role"]
        }
        Relationships: [
          {
            foreignKeyName: "client_team_invites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_team_invites_email_fkey"
            columns: ["email"]
            isOneToOne: false
            referencedRelation: "team_invites"
            referencedColumns: ["email"]
          },
        ]
      }
      clients: {
        Row: {
          active: boolean
          call_followups_checked_at: string | null
          call_notes_checked_at: string | null
          call_notes_client_option: string | null
          call_notes_kind: string | null
          call_notes_notion_id: string | null
          call_notes_title: string | null
          created_at: string
          currency: string
          deal_size_band: string | null
          ga4_property_id: string | null
          id: string
          industry: string | null
          logo_url: string | null
          main_kpi: string
          monthly_kpi_target: number | null
          name: string
          notion_client_option: string
          notion_hq_checked_at: string | null
          notion_hq_page_id: string | null
          regions: string[]
          sales_motion: string | null
          slack_channel: string | null
          slug: string
          sub_industry: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          active?: boolean
          call_followups_checked_at?: string | null
          call_notes_checked_at?: string | null
          call_notes_client_option?: string | null
          call_notes_kind?: string | null
          call_notes_notion_id?: string | null
          call_notes_title?: string | null
          created_at?: string
          currency?: string
          deal_size_band?: string | null
          ga4_property_id?: string | null
          id?: string
          industry?: string | null
          logo_url?: string | null
          main_kpi?: string
          monthly_kpi_target?: number | null
          name: string
          notion_client_option: string
          notion_hq_checked_at?: string | null
          notion_hq_page_id?: string | null
          regions?: string[]
          sales_motion?: string | null
          slack_channel?: string | null
          slug: string
          sub_industry?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          active?: boolean
          call_followups_checked_at?: string | null
          call_notes_checked_at?: string | null
          call_notes_client_option?: string | null
          call_notes_kind?: string | null
          call_notes_notion_id?: string | null
          call_notes_title?: string | null
          created_at?: string
          currency?: string
          deal_size_band?: string | null
          ga4_property_id?: string | null
          id?: string
          industry?: string | null
          logo_url?: string | null
          main_kpi?: string
          monthly_kpi_target?: number | null
          name?: string
          notion_client_option?: string
          notion_hq_checked_at?: string | null
          notion_hq_page_id?: string | null
          regions?: string[]
          sales_motion?: string | null
          slack_channel?: string | null
          slug?: string
          sub_industry?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      competitor_ads: {
        Row: {
          active: boolean
          body: string | null
          client_id: string
          competitor_id: string
          content_type: string | null
          copy_error: string | null
          countries: string[]
          cta: string | null
          ended_on: string | null
          external_id: string
          first_seen_at: string
          format: string | null
          headline: string | null
          id: string
          label_audience: string | null
          label_confidence: string | null
          label_content_type: string | null
          label_digest: string | null
          label_format: string | null
          label_hook: string | null
          label_offer: string | null
          label_summary: string | null
          label_topic: string | null
          labeled_at: string | null
          landing_url: string | null
          last_seen_at: string
          library_url: string | null
          media_url: string | null
          placements: string[]
          raw: Json | null
          relevance: string | null
          relevance_checked_at: string | null
          relevance_digest: string | null
          relevance_reason: string | null
          source: string
          started_on: string | null
          storage_path: string | null
        }
        Insert: {
          active?: boolean
          body?: string | null
          client_id: string
          competitor_id: string
          content_type?: string | null
          copy_error?: string | null
          countries?: string[]
          cta?: string | null
          ended_on?: string | null
          external_id: string
          first_seen_at?: string
          format?: string | null
          headline?: string | null
          id?: string
          label_audience?: string | null
          label_confidence?: string | null
          label_content_type?: string | null
          label_digest?: string | null
          label_format?: string | null
          label_hook?: string | null
          label_offer?: string | null
          label_summary?: string | null
          label_topic?: string | null
          labeled_at?: string | null
          landing_url?: string | null
          last_seen_at?: string
          library_url?: string | null
          media_url?: string | null
          placements?: string[]
          raw?: Json | null
          relevance?: string | null
          relevance_checked_at?: string | null
          relevance_digest?: string | null
          relevance_reason?: string | null
          source: string
          started_on?: string | null
          storage_path?: string | null
        }
        Update: {
          active?: boolean
          body?: string | null
          client_id?: string
          competitor_id?: string
          content_type?: string | null
          copy_error?: string | null
          countries?: string[]
          cta?: string | null
          ended_on?: string | null
          external_id?: string
          first_seen_at?: string
          format?: string | null
          headline?: string | null
          id?: string
          label_audience?: string | null
          label_confidence?: string | null
          label_content_type?: string | null
          label_digest?: string | null
          label_format?: string | null
          label_hook?: string | null
          label_offer?: string | null
          label_summary?: string | null
          label_topic?: string | null
          labeled_at?: string | null
          landing_url?: string | null
          last_seen_at?: string
          library_url?: string | null
          media_url?: string | null
          placements?: string[]
          raw?: Json | null
          relevance?: string | null
          relevance_checked_at?: string | null
          relevance_digest?: string | null
          relevance_reason?: string | null
          source?: string
          started_on?: string | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_ads_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "client_competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_keywords: {
        Row: {
          client_id: string
          created_at: string
          created_by_profile_id: string | null
          id: string
          keyword: string
          removed_at: string | null
          removed_by_profile_id: string | null
          sources: string[]
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          keyword: string
          removed_at?: string | null
          removed_by_profile_id?: string | null
          sources?: string[]
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          keyword?: string
          removed_at?: string | null
          removed_by_profile_id?: string | null
          sources?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "competitor_keywords_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_keywords_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_keywords_removed_by_profile_id_fkey"
            columns: ["removed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_runs: {
        Row: {
          actor: string
          apify_run_id: string | null
          client_id: string
          collected_at: string | null
          competitor_id: string | null
          country: string
          error: string | null
          id: string
          items: number | null
          keyword_id: string | null
          queued_at: string
          source: string
          started_at: string | null
          status: string
          usage_usd: number | null
        }
        Insert: {
          actor: string
          apify_run_id?: string | null
          client_id: string
          collected_at?: string | null
          competitor_id?: string | null
          country: string
          error?: string | null
          id?: string
          items?: number | null
          keyword_id?: string | null
          queued_at?: string
          source: string
          started_at?: string | null
          status?: string
          usage_usd?: number | null
        }
        Update: {
          actor?: string
          apify_run_id?: string | null
          client_id?: string
          collected_at?: string | null
          competitor_id?: string | null
          country?: string
          error?: string | null
          id?: string
          items?: number | null
          keyword_id?: string | null
          queued_at?: string
          source?: string
          started_at?: string | null
          status?: string
          usage_usd?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_runs_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "client_competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_runs_keyword_id_fkey"
            columns: ["keyword_id"]
            isOneToOne: false
            referencedRelation: "competitor_keywords"
            referencedColumns: ["id"]
          },
        ]
      }
      content_idea_actions: {
        Row: {
          action: string
          client_id: string
          created_at: string
          id: string
          idea_id: string
          profile_id: string | null
          reason: string | null
          run_id: string
          snapshot: Json | null
          sprint_test_id: string | null
        }
        Insert: {
          action: string
          client_id: string
          created_at?: string
          id?: string
          idea_id: string
          profile_id?: string | null
          reason?: string | null
          run_id: string
          snapshot?: Json | null
          sprint_test_id?: string | null
        }
        Update: {
          action?: string
          client_id?: string
          created_at?: string
          id?: string
          idea_id?: string
          profile_id?: string | null
          reason?: string | null
          run_id?: string
          snapshot?: Json | null
          sprint_test_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_idea_actions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_idea_actions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_idea_actions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "content_idea_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_idea_actions_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "recommendation_results"
            referencedColumns: ["test_id"]
          },
          {
            foreignKeyName: "content_idea_actions_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "sprint_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      content_idea_runs: {
        Row: {
          archived_at: string | null
          avoid: Json
          client_id: string
          created_at: string
          error: string | null
          finished_at: string | null
          headline: string | null
          id: string
          ideas: Json
          model: string | null
          progress: string | null
          requested_by_profile_id: string | null
          status: string
          usage: Json | null
          working: Json
        }
        Insert: {
          archived_at?: string | null
          avoid?: Json
          client_id: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          headline?: string | null
          id?: string
          ideas?: Json
          model?: string | null
          progress?: string | null
          requested_by_profile_id?: string | null
          status?: string
          usage?: Json | null
          working?: Json
        }
        Update: {
          archived_at?: string | null
          avoid?: Json
          client_id?: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          headline?: string | null
          id?: string
          ideas?: Json
          model?: string | null
          progress?: string | null
          requested_by_profile_id?: string | null
          status?: string
          usage?: Json | null
          working?: Json
        }
        Relationships: [
          {
            foreignKeyName: "content_idea_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_idea_runs_requested_by_profile_id_fkey"
            columns: ["requested_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_pieces: {
        Row: {
          approval_round: number
          approved_at: string | null
          approved_by_profile_id: string | null
          archived_at: string | null
          archived_by_profile_id: string | null
          audiences: string[]
          client_id: string
          code: string
          created_at: string
          created_by_profile_id: string | null
          id: string
          imported_from: string | null
          notion_briefed_at: string | null
          notion_page_id: string | null
          notion_page_url: string | null
          purpose: string | null
          reapproval: boolean
          seq_status: string
          stage: string
          theme: string | null
          title: string
          type: string
          updated_at: string
          updated_by_profile_id: string | null
          url: string | null
          verticals: string[]
        }
        Insert: {
          approval_round?: number
          approved_at?: string | null
          approved_by_profile_id?: string | null
          archived_at?: string | null
          archived_by_profile_id?: string | null
          audiences?: string[]
          client_id: string
          code: string
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          imported_from?: string | null
          notion_briefed_at?: string | null
          notion_page_id?: string | null
          notion_page_url?: string | null
          purpose?: string | null
          reapproval?: boolean
          seq_status?: string
          stage?: string
          theme?: string | null
          title: string
          type: string
          updated_at?: string
          updated_by_profile_id?: string | null
          url?: string | null
          verticals?: string[]
        }
        Update: {
          approval_round?: number
          approved_at?: string | null
          approved_by_profile_id?: string | null
          archived_at?: string | null
          archived_by_profile_id?: string | null
          audiences?: string[]
          client_id?: string
          code?: string
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          imported_from?: string | null
          notion_briefed_at?: string | null
          notion_page_id?: string | null
          notion_page_url?: string | null
          purpose?: string | null
          reapproval?: boolean
          seq_status?: string
          stage?: string
          theme?: string | null
          title?: string
          type?: string
          updated_at?: string
          updated_by_profile_id?: string | null
          url?: string | null
          verticals?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "content_pieces_approved_by_profile_id_fkey"
            columns: ["approved_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_pieces_archived_by_profile_id_fkey"
            columns: ["archived_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_pieces_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_pieces_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_pieces_updated_by_profile_id_fkey"
            columns: ["updated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_sequences: {
        Row: {
          angle: string | null
          client_id: string
          handoff: boolean
          piece_id: string
          slot: number
          suggested_angle: string | null
          suggested_at: string | null
          suggested_handoff: boolean | null
          suggested_target_piece_id: string | null
          target_piece_id: string | null
          updated_at: string
          updated_by_profile_id: string | null
        }
        Insert: {
          angle?: string | null
          client_id: string
          handoff?: boolean
          piece_id: string
          slot: number
          suggested_angle?: string | null
          suggested_at?: string | null
          suggested_handoff?: boolean | null
          suggested_target_piece_id?: string | null
          target_piece_id?: string | null
          updated_at?: string
          updated_by_profile_id?: string | null
        }
        Update: {
          angle?: string | null
          client_id?: string
          handoff?: boolean
          piece_id?: string
          slot?: number
          suggested_angle?: string | null
          suggested_at?: string | null
          suggested_handoff?: boolean | null
          suggested_target_piece_id?: string | null
          target_piece_id?: string | null
          updated_at?: string
          updated_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_sequences_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_sequences_piece_id_fkey"
            columns: ["piece_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_sequences_suggested_target_piece_id_fkey"
            columns: ["suggested_target_piece_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_sequences_target_piece_id_fkey"
            columns: ["target_piece_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_sequences_updated_by_profile_id_fkey"
            columns: ["updated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_field_tiers: {
        Row: {
          account_id: string
          client_id: string
          description: string | null
          field: string
          id: string
          tier: string
          updated_at: string
          updated_by_profile_id: string | null
        }
        Insert: {
          account_id: string
          client_id: string
          description?: string | null
          field: string
          id?: string
          tier: string
          updated_at?: string
          updated_by_profile_id?: string | null
        }
        Update: {
          account_id?: string
          client_id?: string
          description?: string | null
          field?: string
          id?: string
          tier?: string
          updated_at?: string
          updated_by_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversion_field_tiers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "client_platform_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_field_tiers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_field_tiers_updated_by_profile_id_fkey"
            columns: ["updated_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_modified_state: {
        Row: {
          campaign_id: string | null
          checked_at: string
          client_id: string
          creative_id: string
          external_account_id: string
          last_modified: string | null
        }
        Insert: {
          campaign_id?: string | null
          checked_at?: string
          client_id: string
          creative_id: string
          external_account_id: string
          last_modified?: string | null
        }
        Update: {
          campaign_id?: string | null
          checked_at?: string
          client_id?: string
          creative_id?: string
          external_account_id?: string
          last_modified?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creative_modified_state_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          admin_note: string | null
          created_at: string
          details: string | null
          id: string
          kind: string
          page_url: string | null
          profile_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          details?: string | null
          id?: string
          kind: string
          page_url?: string | null
          profile_id?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          details?: string | null
          id?: string
          kind?: string
          page_url?: string | null
          profile_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_actions: {
        Row: {
          action: string
          client_id: string
          created_at: string
          id: string
          insight_key: string
          items: string[]
          note: string | null
          notion_log_id: number | null
          notion_page_id: string | null
          profile_id: string | null
          rule: string
          snapshot: Json | null
          snooze_until: string | null
          sprint_test_id: string | null
        }
        Insert: {
          action: string
          client_id: string
          created_at?: string
          id?: string
          insight_key: string
          items?: string[]
          note?: string | null
          notion_log_id?: number | null
          notion_page_id?: string | null
          profile_id?: string | null
          rule: string
          snapshot?: Json | null
          snooze_until?: string | null
          sprint_test_id?: string | null
        }
        Update: {
          action?: string
          client_id?: string
          created_at?: string
          id?: string
          insight_key?: string
          items?: string[]
          note?: string | null
          notion_log_id?: number | null
          notion_page_id?: string | null
          profile_id?: string | null
          rule?: string
          snapshot?: Json | null
          snooze_until?: string | null
          sprint_test_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insight_actions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_actions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_actions_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "recommendation_results"
            referencedColumns: ["test_id"]
          },
          {
            foreignKeyName: "insight_actions_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "sprint_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_reviews: {
        Row: {
          audiences: Json
          client_id: string
          companies: Json
          created_at: string
          error: string | null
          finished_at: string | null
          goals: Json
          headline: string | null
          id: string
          model: string | null
          ranking: Json
          requested_by_profile_id: string | null
          start_here: Json
          status: string
          terms: Json
          usage: Json | null
        }
        Insert: {
          audiences?: Json
          client_id: string
          companies?: Json
          created_at?: string
          error?: string | null
          finished_at?: string | null
          goals?: Json
          headline?: string | null
          id?: string
          model?: string | null
          ranking?: Json
          requested_by_profile_id?: string | null
          start_here?: Json
          status?: string
          terms?: Json
          usage?: Json | null
        }
        Update: {
          audiences?: Json
          client_id?: string
          companies?: Json
          created_at?: string
          error?: string | null
          finished_at?: string | null
          goals?: Json
          headline?: string | null
          id?: string
          model?: string | null
          ranking?: Json
          requested_by_profile_id?: string | null
          start_here?: Json
          status?: string
          terms?: Json
          usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "insight_reviews_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_reviews_requested_by_profile_id_fkey"
            columns: ["requested_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      keyword_ads: {
        Row: {
          advertiser: string | null
          advertiser_id: string | null
          body: string | null
          client_id: string
          content_type: string | null
          copy_error: string | null
          countries: string[]
          cta: string | null
          ended_on: string | null
          external_id: string
          first_seen_at: string
          format: string | null
          headline: string | null
          id: string
          keyword_id: string
          landing_url: string | null
          last_seen_at: string
          library_url: string | null
          media_url: string | null
          ranks: Json
          relevance: string | null
          relevance_checked_at: string | null
          relevance_digest: string | null
          relevance_reason: string | null
          source: string
          started_on: string | null
          storage_path: string | null
        }
        Insert: {
          advertiser?: string | null
          advertiser_id?: string | null
          body?: string | null
          client_id: string
          content_type?: string | null
          copy_error?: string | null
          countries?: string[]
          cta?: string | null
          ended_on?: string | null
          external_id: string
          first_seen_at?: string
          format?: string | null
          headline?: string | null
          id?: string
          keyword_id: string
          landing_url?: string | null
          last_seen_at?: string
          library_url?: string | null
          media_url?: string | null
          ranks?: Json
          relevance?: string | null
          relevance_checked_at?: string | null
          relevance_digest?: string | null
          relevance_reason?: string | null
          source: string
          started_on?: string | null
          storage_path?: string | null
        }
        Update: {
          advertiser?: string | null
          advertiser_id?: string | null
          body?: string | null
          client_id?: string
          content_type?: string | null
          copy_error?: string | null
          countries?: string[]
          cta?: string | null
          ended_on?: string | null
          external_id?: string
          first_seen_at?: string
          format?: string | null
          headline?: string | null
          id?: string
          keyword_id?: string
          landing_url?: string | null
          last_seen_at?: string
          library_url?: string | null
          media_url?: string | null
          ranks?: Json
          relevance?: string | null
          relevance_checked_at?: string | null
          relevance_digest?: string | null
          relevance_reason?: string | null
          source?: string
          started_on?: string | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "keyword_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keyword_ads_keyword_id_fkey"
            columns: ["keyword_id"]
            isOneToOne: false
            referencedRelation: "competitor_keywords"
            referencedColumns: ["id"]
          },
        ]
      }
      news_answers: {
        Row: {
          answer: string
          created_at: string
          model: string | null
          question: string
          sources: Json
          usage: Json | null
        }
        Insert: {
          answer: string
          created_at?: string
          model?: string | null
          question: string
          sources?: Json
          usage?: Json | null
        }
        Update: {
          answer?: string
          created_at?: string
          model?: string | null
          question?: string
          sources?: Json
          usage?: Json | null
        }
        Relationships: []
      }
      notion_pages_mirror: {
        Row: {
          client_id: string | null
          created_by_app: boolean
          data_source_id: string
          in_trash: boolean
          last_edited_time: string
          notion_page_id: string
          page_type: Database["public"]["Enums"]["notion_page_type"]
          parent_page_id: string | null
          properties: Json
          synced_at: string
          title: string | null
          url: string | null
        }
        Insert: {
          client_id?: string | null
          created_by_app?: boolean
          data_source_id: string
          in_trash?: boolean
          last_edited_time: string
          notion_page_id: string
          page_type?: Database["public"]["Enums"]["notion_page_type"]
          parent_page_id?: string | null
          properties?: Json
          synced_at?: string
          title?: string | null
          url?: string | null
        }
        Update: {
          client_id?: string | null
          created_by_app?: boolean
          data_source_id?: string
          in_trash?: boolean
          last_edited_time?: string
          notion_page_id?: string
          page_type?: Database["public"]["Enums"]["notion_page_type"]
          parent_page_id?: string | null
          properties?: Json
          synced_at?: string
          title?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notion_pages_mirror_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      notion_sync_state: {
        Row: {
          data_source_id: string
          last_full_sync_at: string | null
          last_synced_at: string | null
          max_last_edited_time: string | null
        }
        Insert: {
          data_source_id: string
          last_full_sync_at?: string | null
          last_synced_at?: string | null
          max_last_edited_time?: string | null
        }
        Update: {
          data_source_id?: string
          last_full_sync_at?: string | null
          last_synced_at?: string | null
          max_last_edited_time?: string | null
        }
        Relationships: []
      }
      notion_write_log: {
        Row: {
          brief_key: string | null
          campaign_brief_id: string | null
          check_result_id: string | null
          client_id: string | null
          completed_at: string | null
          content_piece_id: string | null
          created_at: string
          dry_run: boolean
          endpoint: string
          id: number
          operation: string
          payload: Json
          profile_id: string | null
          response: Json | null
          sprint_test_id: string | null
          success: boolean | null
        }
        Insert: {
          brief_key?: string | null
          campaign_brief_id?: string | null
          check_result_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          content_piece_id?: string | null
          created_at?: string
          dry_run: boolean
          endpoint: string
          id?: never
          operation: string
          payload: Json
          profile_id?: string | null
          response?: Json | null
          sprint_test_id?: string | null
          success?: boolean | null
        }
        Update: {
          brief_key?: string | null
          campaign_brief_id?: string | null
          check_result_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          content_piece_id?: string | null
          created_at?: string
          dry_run?: boolean
          endpoint?: string
          id?: never
          operation?: string
          payload?: Json
          profile_id?: string | null
          response?: Json | null
          sprint_test_id?: string | null
          success?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "notion_write_log_campaign_brief_id_fkey"
            columns: ["campaign_brief_id"]
            isOneToOne: false
            referencedRelation: "campaign_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notion_write_log_check_result_id_fkey"
            columns: ["check_result_id"]
            isOneToOne: false
            referencedRelation: "check_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notion_write_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notion_write_log_content_piece_id_fkey"
            columns: ["content_piece_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notion_write_log_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notion_write_log_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "recommendation_results"
            referencedColumns: ["test_id"]
          },
          {
            foreignKeyName: "notion_write_log_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "sprint_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_changes: {
        Row: {
          actor: string | null
          bulk: boolean
          campaign_id: string | null
          campaign_name: string | null
          campaigns: string[]
          change_count: number
          change_key: string
          changed_at: string
          client_id: string
          detail: string | null
          external_account_id: string
          id: string
          object_name: string | null
          object_type: string
          operation: string
          platform: Database["public"]["Enums"]["platform"]
          summary: string
          synced_at: string
          via: string | null
        }
        Insert: {
          actor?: string | null
          bulk?: boolean
          campaign_id?: string | null
          campaign_name?: string | null
          campaigns?: string[]
          change_count?: number
          change_key: string
          changed_at: string
          client_id: string
          detail?: string | null
          external_account_id: string
          id?: string
          object_name?: string | null
          object_type: string
          operation: string
          platform: Database["public"]["Enums"]["platform"]
          summary: string
          synced_at?: string
          via?: string | null
        }
        Update: {
          actor?: string | null
          bulk?: boolean
          campaign_id?: string | null
          campaign_name?: string | null
          campaigns?: string[]
          change_count?: number
          change_key?: string
          changed_at?: string
          client_id?: string
          detail?: string | null
          external_account_id?: string
          id?: string
          object_name?: string | null
          object_type?: string
          operation?: string
          platform?: Database["public"]["Enums"]["platform"]
          summary?: string
          synced_at?: string
          via?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_changes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          campaign_id: string
          campaign_name: string | null
          checked_at: string
          client_id: string
          entity_id: string
          entity_name: string | null
          external_account_id: string
          level: string
          platform: string
          settings: Json
        }
        Insert: {
          campaign_id: string
          campaign_name?: string | null
          checked_at?: string
          client_id: string
          entity_id: string
          entity_name?: string | null
          external_account_id: string
          level: string
          platform: string
          settings?: Json
        }
        Update: {
          campaign_id?: string
          campaign_name?: string | null
          checked_at?: string
          client_id?: string
          entity_id?: string
          entity_name?: string | null
          external_account_id?: string
          level?: string
          platform?: string
          settings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "platform_settings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_write_log: {
        Row: {
          ad_group_id: string | null
          ad_id: string | null
          campaign_build_id: string | null
          campaign_id: string | null
          client_id: string
          completed_at: string | null
          created_at: string
          dry_run: boolean
          external_account_id: string
          id: number
          idempotency_key: string | null
          operation: string
          payload: Json
          platform: string
          previous: Json | null
          profile_id: string | null
          response: Json | null
          sprint_test_id: string | null
          step: string | null
          success: boolean | null
        }
        Insert: {
          ad_group_id?: string | null
          ad_id?: string | null
          campaign_build_id?: string | null
          campaign_id?: string | null
          client_id: string
          completed_at?: string | null
          created_at?: string
          dry_run: boolean
          external_account_id: string
          id?: never
          idempotency_key?: string | null
          operation: string
          payload: Json
          platform: string
          previous?: Json | null
          profile_id?: string | null
          response?: Json | null
          sprint_test_id?: string | null
          step?: string | null
          success?: boolean | null
        }
        Update: {
          ad_group_id?: string | null
          ad_id?: string | null
          campaign_build_id?: string | null
          campaign_id?: string | null
          client_id?: string
          completed_at?: string | null
          created_at?: string
          dry_run?: boolean
          external_account_id?: string
          id?: never
          idempotency_key?: string | null
          operation?: string
          payload?: Json
          platform?: string
          previous?: Json | null
          profile_id?: string | null
          response?: Json | null
          sprint_test_id?: string | null
          step?: string | null
          success?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_write_log_campaign_build_id_fkey"
            columns: ["campaign_build_id"]
            isOneToOne: false
            referencedRelation: "campaign_builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_write_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_write_log_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_write_log_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "recommendation_results"
            referencedColumns: ["test_id"]
          },
          {
            foreignKeyName: "platform_write_log_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "sprint_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          job_title: string | null
          last_seen_at: string | null
          location: string | null
          notion_user_id: string | null
          phone: string | null
          preferences: Json
          role: Database["public"]["Enums"]["app_role"] | null
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          job_title?: string | null
          last_seen_at?: string | null
          location?: string | null
          notion_user_id?: string | null
          phone?: string | null
          preferences?: Json
          role?: Database["public"]["Enums"]["app_role"] | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          job_title?: string | null
          last_seen_at?: string | null
          location?: string | null
          notion_user_id?: string | null
          phone?: string | null
          preferences?: Json
          role?: Database["public"]["Enums"]["app_role"] | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      rate_limit_events: {
        Row: {
          created_at: string
          id: number
          kind: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          kind: string
          profile_id: string
        }
        Update: {
          created_at?: string
          id?: never
          kind?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limit_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_links: {
        Row: {
          board: string
          campaign_id: string | null
          client_id: string
          created_at: string
          created_by_profile_id: string | null
          default_days: number
          default_range: string | null
          id: string
          kind: string
          label: string | null
          last_viewed_at: string | null
          note: string | null
          revoked_at: string | null
          revoked_by_profile_id: string | null
          token: string
        }
        Insert: {
          board: string
          campaign_id?: string | null
          client_id: string
          created_at?: string
          created_by_profile_id?: string | null
          default_days?: number
          default_range?: string | null
          id?: string
          kind?: string
          label?: string | null
          last_viewed_at?: string | null
          note?: string | null
          revoked_at?: string | null
          revoked_by_profile_id?: string | null
          token: string
        }
        Update: {
          board?: string
          campaign_id?: string | null
          client_id?: string
          created_at?: string
          created_by_profile_id?: string | null
          default_days?: number
          default_range?: string | null
          id?: string
          kind?: string
          label?: string | null
          last_viewed_at?: string | null
          note?: string | null
          revoked_at?: string | null
          revoked_by_profile_id?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_links_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_links_revoked_by_profile_id_fkey"
            columns: ["revoked_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_posts: {
        Row: {
          channel: string | null
          client_id: string
          created_at: string
          error: string | null
          finished_at: string | null
          id: number
          kind: string
          manual: boolean
          message: Json | null
          period_end: string
          period_start: string
          sent_by: string | null
          slack_ts: string | null
          status: string
        }
        Insert: {
          channel?: string | null
          client_id: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: never
          kind?: string
          manual?: boolean
          message?: Json | null
          period_end: string
          period_start: string
          sent_by?: string | null
          slack_ts?: string | null
          status: string
        }
        Update: {
          channel?: string | null
          client_id?: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: never
          kind?: string
          manual?: boolean
          message?: Json | null
          period_end?: string
          period_start?: string
          sent_by?: string | null
          slack_ts?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_posts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slack_posts_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sprint_ai_runs: {
        Row: {
          archived_at: string | null
          client_id: string
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          market_summary: string | null
          model: string | null
          news: Json
          progress: number
          requested_by_profile_id: string | null
          sprint_id: string
          stage: string
          stage_note: string | null
          status: string
          usage: Json | null
        }
        Insert: {
          archived_at?: string | null
          client_id: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          market_summary?: string | null
          model?: string | null
          news?: Json
          progress?: number
          requested_by_profile_id?: string | null
          sprint_id: string
          stage?: string
          stage_note?: string | null
          status?: string
          usage?: Json | null
        }
        Update: {
          archived_at?: string | null
          client_id?: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          market_summary?: string | null
          model?: string | null
          news?: Json
          progress?: number
          requested_by_profile_id?: string | null
          sprint_id?: string
          stage?: string
          stage_note?: string | null
          status?: string
          usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "sprint_ai_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_ai_runs_requested_by_profile_id_fkey"
            columns: ["requested_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_ai_runs_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
        ]
      }
      sprint_changes: {
        Row: {
          campaign_name: string | null
          changed_on: string
          client_id: string
          created_at: string
          created_by_profile_id: string | null
          description: string
          detected_key: string | null
          hypothesis_item_id: string | null
          id: string
          platform: Database["public"]["Enums"]["platform"] | null
          source: string
          sprint_id: string
          status: string
          type: Database["public"]["Enums"]["change_type"]
        }
        Insert: {
          campaign_name?: string | null
          changed_on: string
          client_id: string
          created_at?: string
          created_by_profile_id?: string | null
          description: string
          detected_key?: string | null
          hypothesis_item_id?: string | null
          id?: string
          platform?: Database["public"]["Enums"]["platform"] | null
          source?: string
          sprint_id: string
          status?: string
          type?: Database["public"]["Enums"]["change_type"]
        }
        Update: {
          campaign_name?: string | null
          changed_on?: string
          client_id?: string
          created_at?: string
          created_by_profile_id?: string | null
          description?: string
          detected_key?: string | null
          hypothesis_item_id?: string | null
          id?: string
          platform?: Database["public"]["Enums"]["platform"] | null
          source?: string
          sprint_id?: string
          status?: string
          type?: Database["public"]["Enums"]["change_type"]
        }
        Relationships: [
          {
            foreignKeyName: "sprint_changes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_changes_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_changes_hypothesis_item_id_fkey"
            columns: ["hypothesis_item_id"]
            isOneToOne: false
            referencedRelation: "sprint_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_changes_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
        ]
      }
      sprint_items: {
        Row: {
          carried_from_item_id: string | null
          carry_forward: boolean
          check_result_id: string | null
          client_id: string
          created_at: string
          created_by_profile_id: string | null
          id: string
          kind: Database["public"]["Enums"]["sprint_item_kind"]
          notion_page_id: string | null
          origin_kind: Database["public"]["Enums"]["sprint_item_kind"] | null
          origin_sprint_number: number | null
          outcome: Database["public"]["Enums"]["hypothesis_outcome"] | null
          sprint_id: string
          status: Database["public"]["Enums"]["sprint_item_status"]
          text: string
          updated_at: string
        }
        Insert: {
          carried_from_item_id?: string | null
          carry_forward?: boolean
          check_result_id?: string | null
          client_id: string
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["sprint_item_kind"]
          notion_page_id?: string | null
          origin_kind?: Database["public"]["Enums"]["sprint_item_kind"] | null
          origin_sprint_number?: number | null
          outcome?: Database["public"]["Enums"]["hypothesis_outcome"] | null
          sprint_id: string
          status?: Database["public"]["Enums"]["sprint_item_status"]
          text: string
          updated_at?: string
        }
        Update: {
          carried_from_item_id?: string | null
          carry_forward?: boolean
          check_result_id?: string | null
          client_id?: string
          created_at?: string
          created_by_profile_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["sprint_item_kind"]
          notion_page_id?: string | null
          origin_kind?: Database["public"]["Enums"]["sprint_item_kind"] | null
          origin_sprint_number?: number | null
          outcome?: Database["public"]["Enums"]["hypothesis_outcome"] | null
          sprint_id?: string
          status?: Database["public"]["Enums"]["sprint_item_status"]
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sprint_items_carried_from_item_id_fkey"
            columns: ["carried_from_item_id"]
            isOneToOne: false
            referencedRelation: "sprint_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_items_check_result_id_fkey"
            columns: ["check_result_id"]
            isOneToOne: false
            referencedRelation: "check_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_items_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_items_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
        ]
      }
      sprint_recommendations: {
        Row: {
          assets: string[]
          brief_notes: string | null
          call_commitment_id: string | null
          client_id: string
          confidence: string | null
          created_at: string
          decided_at: string | null
          decided_by_profile_id: string | null
          effort: string | null
          evidence: Json
          expected_impact: string | null
          hypothesis: string | null
          id: string
          impact: string | null
          lever: string | null
          platform: string
          position: number
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by_profile_id: string | null
          run_id: string
          sources: Json
          sprint_id: string
          sprint_test_id: string | null
          status: string
          success_metric: string | null
          success_target: number | null
          success_text: string | null
          summary: string | null
          title: string
          updated_at: string
          why_data: string | null
          why_market: string | null
        }
        Insert: {
          assets?: string[]
          brief_notes?: string | null
          call_commitment_id?: string | null
          client_id: string
          confidence?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_profile_id?: string | null
          effort?: string | null
          evidence?: Json
          expected_impact?: string | null
          hypothesis?: string | null
          id?: string
          impact?: string | null
          lever?: string | null
          platform: string
          position?: number
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by_profile_id?: string | null
          run_id: string
          sources?: Json
          sprint_id: string
          sprint_test_id?: string | null
          status?: string
          success_metric?: string | null
          success_target?: number | null
          success_text?: string | null
          summary?: string | null
          title: string
          updated_at?: string
          why_data?: string | null
          why_market?: string | null
        }
        Update: {
          assets?: string[]
          brief_notes?: string | null
          call_commitment_id?: string | null
          client_id?: string
          confidence?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_profile_id?: string | null
          effort?: string | null
          evidence?: Json
          expected_impact?: string | null
          hypothesis?: string | null
          id?: string
          impact?: string | null
          lever?: string | null
          platform?: string
          position?: number
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by_profile_id?: string | null
          run_id?: string
          sources?: Json
          sprint_id?: string
          sprint_test_id?: string | null
          status?: string
          success_metric?: string | null
          success_target?: number | null
          success_text?: string | null
          summary?: string | null
          title?: string
          updated_at?: string
          why_data?: string | null
          why_market?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sprint_recommendations_call_commitment_id_fkey"
            columns: ["call_commitment_id"]
            isOneToOne: false
            referencedRelation: "call_commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_recommendations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_recommendations_decided_by_profile_id_fkey"
            columns: ["decided_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_recommendations_reviewed_by_profile_id_fkey"
            columns: ["reviewed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_recommendations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "sprint_ai_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_recommendations_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_recommendations_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "recommendation_results"
            referencedColumns: ["test_id"]
          },
          {
            foreignKeyName: "sprint_recommendations_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "sprint_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      sprint_tests: {
        Row: {
          archived_at: string | null
          assets: string[]
          brief_notes: string | null
          briefed_at: string | null
          call_commitment_id: string | null
          campaign_ids: string[]
          campaign_names: string[]
          carried_from_test_id: string | null
          carry_note: string | null
          carry_reason: Database["public"]["Enums"]["carry_reason"] | null
          client_id: string
          content_idea_id: string | null
          created_at: string
          created_by_profile_id: string | null
          deadline: string | null
          findings_blockers: string | null
          findings_notes: string | null
          findings_worked: string | null
          hypothesis: string | null
          id: string
          insight_key: string | null
          lever: string | null
          lever_source: string | null
          live_on: string | null
          notion_page_id: string | null
          outcome: Database["public"]["Enums"]["test_outcome"] | null
          owner_name: string | null
          owner_notion_user_id: string | null
          platform: Database["public"]["Enums"]["platform"] | null
          ready_at: string | null
          recommendation_id: string | null
          sprint_id: string
          status: Database["public"]["Enums"]["test_status"]
          success_metric: string | null
          success_target: number | null
          success_text: string | null
          test_ad_ids: string[]
          test_kind: string | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assets?: string[]
          brief_notes?: string | null
          briefed_at?: string | null
          call_commitment_id?: string | null
          campaign_ids?: string[]
          campaign_names?: string[]
          carried_from_test_id?: string | null
          carry_note?: string | null
          carry_reason?: Database["public"]["Enums"]["carry_reason"] | null
          client_id: string
          content_idea_id?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          deadline?: string | null
          findings_blockers?: string | null
          findings_notes?: string | null
          findings_worked?: string | null
          hypothesis?: string | null
          id?: string
          insight_key?: string | null
          lever?: string | null
          lever_source?: string | null
          live_on?: string | null
          notion_page_id?: string | null
          outcome?: Database["public"]["Enums"]["test_outcome"] | null
          owner_name?: string | null
          owner_notion_user_id?: string | null
          platform?: Database["public"]["Enums"]["platform"] | null
          ready_at?: string | null
          recommendation_id?: string | null
          sprint_id: string
          status?: Database["public"]["Enums"]["test_status"]
          success_metric?: string | null
          success_target?: number | null
          success_text?: string | null
          test_ad_ids?: string[]
          test_kind?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assets?: string[]
          brief_notes?: string | null
          briefed_at?: string | null
          call_commitment_id?: string | null
          campaign_ids?: string[]
          campaign_names?: string[]
          carried_from_test_id?: string | null
          carry_note?: string | null
          carry_reason?: Database["public"]["Enums"]["carry_reason"] | null
          client_id?: string
          content_idea_id?: string | null
          created_at?: string
          created_by_profile_id?: string | null
          deadline?: string | null
          findings_blockers?: string | null
          findings_notes?: string | null
          findings_worked?: string | null
          hypothesis?: string | null
          id?: string
          insight_key?: string | null
          lever?: string | null
          lever_source?: string | null
          live_on?: string | null
          notion_page_id?: string | null
          outcome?: Database["public"]["Enums"]["test_outcome"] | null
          owner_name?: string | null
          owner_notion_user_id?: string | null
          platform?: Database["public"]["Enums"]["platform"] | null
          ready_at?: string | null
          recommendation_id?: string | null
          sprint_id?: string
          status?: Database["public"]["Enums"]["test_status"]
          success_metric?: string | null
          success_target?: number | null
          success_text?: string | null
          test_ad_ids?: string[]
          test_kind?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sprint_tests_call_commitment_id_fkey"
            columns: ["call_commitment_id"]
            isOneToOne: false
            referencedRelation: "call_commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_tests_carried_from_test_id_fkey"
            columns: ["carried_from_test_id"]
            isOneToOne: false
            referencedRelation: "recommendation_results"
            referencedColumns: ["test_id"]
          },
          {
            foreignKeyName: "sprint_tests_carried_from_test_id_fkey"
            columns: ["carried_from_test_id"]
            isOneToOne: false
            referencedRelation: "sprint_tests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_tests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_tests_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_tests_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "recommendation_results"
            referencedColumns: ["recommendation_id"]
          },
          {
            foreignKeyName: "sprint_tests_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "sprint_recommendations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_tests_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
        ]
      }
      sprints: {
        Row: {
          challenges: string | null
          client_id: string
          closed_at: string | null
          closed_by_profile_id: string | null
          created_at: string
          end_date: string
          goal: string | null
          highlights: string | null
          id: string
          key_takeaway: string | null
          number: number
          progress_made: string | null
          start_date: string
          summary: Json | null
          updated_at: string
        }
        Insert: {
          challenges?: string | null
          client_id: string
          closed_at?: string | null
          closed_by_profile_id?: string | null
          created_at?: string
          end_date: string
          goal?: string | null
          highlights?: string | null
          id?: string
          key_takeaway?: string | null
          number: number
          progress_made?: string | null
          start_date: string
          summary?: Json | null
          updated_at?: string
        }
        Update: {
          challenges?: string | null
          client_id?: string
          closed_at?: string | null
          closed_by_profile_id?: string | null
          created_at?: string
          end_date?: string
          goal?: string | null
          highlights?: string | null
          id?: string
          key_takeaway?: string | null
          number?: number
          progress_made?: string | null
          start_date?: string
          summary?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sprints_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprints_closed_by_profile_id_fkey"
            columns: ["closed_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invites: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          notion_user_id: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          notion_user_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          notion_user_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      term_reviews: {
        Row: {
          campaign_id: string
          client_id: string
          created_at: string
          from_date: string
          headline: string
          id: string
          keywords: Json
          model: string
          platform: string
          points: Json
          requested_by_profile_id: string | null
          roots: Json
          terms: Json
          terms_sent: number
          to_date: string
          usage: Json | null
        }
        Insert: {
          campaign_id: string
          client_id: string
          created_at?: string
          from_date: string
          headline: string
          id?: string
          keywords?: Json
          model: string
          platform: string
          points?: Json
          requested_by_profile_id?: string | null
          roots?: Json
          terms?: Json
          terms_sent: number
          to_date: string
          usage?: Json | null
        }
        Update: {
          campaign_id?: string
          client_id?: string
          created_at?: string
          from_date?: string
          headline?: string
          id?: string
          keywords?: Json
          model?: string
          platform?: string
          points?: Json
          requested_by_profile_id?: string | null
          roots?: Json
          terms?: Json
          terms_sent?: number
          to_date?: string
          usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "term_reviews_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "term_reviews_requested_by_profile_id_fkey"
            columns: ["requested_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      test_reads: {
        Row: {
          client_id: string
          confidence: string | null
          created_at: string
          headline: string
          id: string
          model: string | null
          next_step: string | null
          next_step_kind: string | null
          points: Json
          read_on: string
          requested_by_profile_id: string | null
          sprint_test_id: string
          usage: Json | null
          verdict: string
        }
        Insert: {
          client_id: string
          confidence?: string | null
          created_at?: string
          headline: string
          id?: string
          model?: string | null
          next_step?: string | null
          next_step_kind?: string | null
          points?: Json
          read_on: string
          requested_by_profile_id?: string | null
          sprint_test_id: string
          usage?: Json | null
          verdict: string
        }
        Update: {
          client_id?: string
          confidence?: string | null
          created_at?: string
          headline?: string
          id?: string
          model?: string | null
          next_step?: string | null
          next_step_kind?: string | null
          points?: Json
          read_on?: string
          requested_by_profile_id?: string | null
          sprint_test_id?: string
          usage?: Json | null
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_reads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_reads_requested_by_profile_id_fkey"
            columns: ["requested_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_reads_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "recommendation_results"
            referencedColumns: ["test_id"]
          },
          {
            foreignKeyName: "test_reads_sprint_test_id_fkey"
            columns: ["sprint_test_id"]
            isOneToOne: false
            referencedRelation: "sprint_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      windsor_breakdowns: {
        Row: {
          campaign_id: string
          campaign_name: string | null
          clicks: number
          client_id: string
          conversions: number
          date: string
          dim1: string
          dim2: string
          external_account_id: string
          extra: Json | null
          group_id: string
          group_name: string | null
          id: number
          impressions: number
          kind: string
          leads: number
          source: string
          spend: number
          synced_at: string
        }
        Insert: {
          campaign_id?: string
          campaign_name?: string | null
          clicks?: number
          client_id: string
          conversions?: number
          date: string
          dim1?: string
          dim2?: string
          external_account_id: string
          extra?: Json | null
          group_id?: string
          group_name?: string | null
          id?: number
          impressions?: number
          kind: string
          leads?: number
          source: string
          spend?: number
          synced_at?: string
        }
        Update: {
          campaign_id?: string
          campaign_name?: string | null
          clicks?: number
          client_id?: string
          conversions?: number
          date?: string
          dim1?: string
          dim2?: string
          external_account_id?: string
          extra?: Json | null
          group_id?: string
          group_name?: string | null
          id?: number
          impressions?: number
          kind?: string
          leads?: number
          source?: string
          spend?: number
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "windsor_breakdowns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      windsor_daily_metrics: {
        Row: {
          ad_id: string
          ad_name: string | null
          campaign_id: string
          campaign_name: string | null
          clicks: number
          client_id: string
          conversions: number
          date: string
          external_account_id: string
          id: number
          impressions: number
          leads: number
          platform: Database["public"]["Enums"]["platform"]
          raw: Json
          spend: number
          synced_at: string
        }
        Insert: {
          ad_id?: string
          ad_name?: string | null
          campaign_id?: string
          campaign_name?: string | null
          clicks?: number
          client_id: string
          conversions?: number
          date: string
          external_account_id: string
          id?: never
          impressions?: number
          leads?: number
          platform: Database["public"]["Enums"]["platform"]
          raw?: Json
          spend?: number
          synced_at?: string
        }
        Update: {
          ad_id?: string
          ad_name?: string | null
          campaign_id?: string
          campaign_name?: string | null
          clicks?: number
          client_id?: string
          conversions?: number
          date?: string
          external_account_id?: string
          id?: never
          impressions?: number
          leads?: number
          platform?: Database["public"]["Enums"]["platform"]
          raw?: Json
          spend?: number
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "windsor_daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      windsor_sync_runs: {
        Row: {
          client_id: string | null
          date_from: string
          date_to: string
          error: string | null
          finished_at: string | null
          id: number
          kind: string
          rows_upserted: number | null
          started_at: string
          success: boolean | null
        }
        Insert: {
          client_id?: string | null
          date_from: string
          date_to: string
          error?: string | null
          finished_at?: string | null
          id?: never
          kind: string
          rows_upserted?: number | null
          started_at?: string
          success?: boolean | null
        }
        Update: {
          client_id?: string | null
          date_from?: string
          date_to?: string
          error?: string | null
          finished_at?: string | null
          id?: never
          kind?: string
          rows_upserted?: number | null
          started_at?: string
          success?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "windsor_sync_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      account_data_range: {
        Row: {
          client_id: string | null
          data_from: string | null
          data_through: string | null
          external_account_id: string | null
          platform: Database["public"]["Enums"]["platform"] | null
        }
        Relationships: [
          {
            foreignKeyName: "windsor_daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_lifetimes: {
        Row: {
          ad_id: string | null
          ad_name: string | null
          campaign_name: string | null
          client_id: string | null
          external_account_id: string | null
          first_seen: string | null
          last_seen: string | null
          platform: Database["public"]["Enums"]["platform"] | null
        }
        Relationships: [
          {
            foreignKeyName: "windsor_daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_results: {
        Row: {
          carry_reason: Database["public"]["Enums"]["carry_reason"] | null
          client_id: string | null
          confidence: string | null
          decided_at: string | null
          decision: string | null
          effort: string | null
          findings_blockers: string | null
          findings_worked: string | null
          impact: string | null
          outcome: Database["public"]["Enums"]["test_outcome"] | null
          platform: string | null
          recommendation_id: string | null
          reject_reason: string | null
          run_id: string | null
          suggested_at: string | null
          suggested_in_sprint_id: string | null
          test_id: string | null
          test_sprint_id: string | null
          test_status: Database["public"]["Enums"]["test_status"] | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sprint_recommendations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_recommendations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "sprint_ai_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_recommendations_sprint_id_fkey"
            columns: ["suggested_in_sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_tests_sprint_id_fkey"
            columns: ["test_sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      ad_fatigue_inputs: {
        Args: { p_client: string }
        Returns: {
          ad_id: string
          ad_name: string
          campaign_name: string
          data_from: string
          data_through: string
          early_clicks: number
          early_conversions: number
          early_impressions: number
          early_leads: number
          early_spend: number
          external_account_id: string
          first_seen: string
          live: boolean
          platform: Database["public"]["Enums"]["platform"]
          recent_clicks: number
          recent_conversions: number
          recent_impressions: number
          recent_leads: number
          recent_spend: number
        }[]
      }
      ad_stats: {
        Args: { p_client: string; p_from: string; p_to: string }
        Returns: {
          ad_id: string
          ad_name: string
          campaign_name: string
          clicks: number
          conversions: number
          external_account_id: string
          impressions: number
          leads: number
          platform: Database["public"]["Enums"]["platform"]
          spend: number
        }[]
      }
      ad_totals: {
        Args: { p_client: string; p_from: string; p_to: string }
        Returns: {
          ad_id: string
          ad_name: string
          campaign_id: string
          campaign_name: string
          clicks: number
          conversions: number
          external_account_id: string
          impressions: number
          leads: number
          platform: Database["public"]["Enums"]["platform"]
          spend: number
        }[]
      }
      ads_api_token: { Args: { p_platform: string }; Returns: string }
      breakdown_totals: {
        Args: {
          p_campaign?: string
          p_client: string
          p_from: string
          p_kind: string
          p_to: string
        }
        Returns: {
          campaign_id: string
          campaign_name: string
          clicks: number
          conversions: number
          days: number
          dim1: string
          dim2: string
          extra: Json
          group_id: string
          group_name: string
          impressions: number
          leads: number
          spend: number
        }[]
      }
      campaign_ads: {
        Args: {
          p_campaign_id: string
          p_client: string
          p_from: string
          p_platform: Database["public"]["Enums"]["platform"]
          p_to: string
        }
        Returns: {
          ad_id: string
          ad_name: string
          clicks: number
          conversions: number
          external_account_id: string
          first_date: string
          impressions: number
          last_date: string
          leads: number
          platform: Database["public"]["Enums"]["platform"]
          spend: number
        }[]
      }
      campaign_daily: {
        Args: { p_client: string; p_from: string; p_to: string }
        Returns: {
          campaign_id: string
          campaign_name: string
          clicks: number
          conversions: number
          date: string
          impressions: number
          leads: number
          platform: Database["public"]["Enums"]["platform"]
          spend: number
        }[]
      }
      campaign_month: {
        Args: { p_client: string; p_from: string; p_to: string }
        Returns: {
          campaign_id: string
          campaign_name: string
          last_date: string
          platform: Database["public"]["Enums"]["platform"]
          spend: number
          spend_last2: number
        }[]
      }
      campaign_series: {
        Args: {
          p_bucket: string
          p_client: string
          p_from: string
          p_to: string
        }
        Returns: {
          campaign_id: string
          campaign_name: string
          clicks: number
          conversions: number
          date: string
          impressions: number
          leads: number
          platform: Database["public"]["Enums"]["platform"]
          spend: number
        }[]
      }
      campaign_totals: {
        Args: {
          p_campaign_ids: string[]
          p_client: string
          p_from: string
          p_platform: Database["public"]["Enums"]["platform"]
          p_to: string
        }
        Returns: {
          clicks: number
          conversions: number
          data_through: string
          days: number
          impressions: number
          leads: number
          spend: number
        }[]
      }
      can_access_client: { Args: { cid: string }; Returns: boolean }
      can_edit_client: { Args: { cid: string }; Returns: boolean }
      can_run_content_ideas: { Args: { cid: string }; Returns: boolean }
      can_share_reports: { Args: { cid: string }; Returns: boolean }
      change_actor: { Args: never; Returns: string }
      change_value: { Args: { v: Json }; Returns: Json }
      client_campaigns: {
        Args: { p_client: string; p_from: string }
        Returns: {
          campaign_id: string
          campaign_name: string
          last_date: string
          platform: Database["public"]["Enums"]["platform"]
          spend: number
        }[]
      }
      client_data_range: {
        Args: { p_client: string }
        Returns: {
          data_from: string
          data_through: string
          external_account_id: string
          platform: Database["public"]["Enums"]["platform"]
        }[]
      }
      client_data_stamp: { Args: { p_client: string }; Returns: string }
      ga4_landing_totals: {
        Args: { p_client: string; p_from: string; p_to: string }
        Returns: {
          avg_duration: number
          conversions: number
          engaged: number
          page: string
          sessions: number
          source_medium: string
        }[]
      }
      has_role: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_viewer: { Args: never; Returns: boolean }
      my_client_ids: { Args: never; Returns: string[] }
      platform_daily: {
        Args: { p_client: string; p_from: string; p_to: string }
        Returns: {
          clicks: number
          conversions: number
          date: string
          external_account_id: string
          impressions: number
          leads: number
          platform: Database["public"]["Enums"]["platform"]
          spend: number
        }[]
      }
      search_term_candidates: {
        Args: {
          p_client: string
          p_from: string
          p_min_results: number
          p_min_spend: number
          p_to: string
        }
        Returns: {
          campaign_id: string
          campaign_name: string
          clicks: number
          impressions: number
          is_keyword: boolean
          results: number
          spend: number
          term: string
        }[]
      }
      set_ads_api_token: {
        Args: { p_platform: string; p_token: string }
        Returns: undefined
      }
      sprint_ad_events: {
        Args: { p_client: string; p_from: string; p_to: string }
        Returns: {
          ad_id: string
          ad_name: string
          campaign_name: string
          data_through: string
          external_account_id: string
          first_seen: string
          last_seen: string
          platform: Database["public"]["Enums"]["platform"]
          spend_in_range: number
        }[]
      }
      take_rate_limit: {
        Args: { p_kind: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      test_ads: {
        Args: {
          p_campaign_ids: string[]
          p_client: string
          p_from: string
          p_platform: Database["public"]["Enums"]["platform"]
          p_to: string
        }
        Returns: {
          ad_id: string
          ad_name: string
          campaign_id: string
          clicks: number
          conversions: number
          external_account_id: string
          first_seen: string
          impressions: number
          leads: number
          platform: Database["public"]["Enums"]["platform"]
          spend: number
        }[]
      }
      touch_last_seen: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role:
        | "admin"
        | "gtm_lead"
        | "am"
        | "specialist"
        | "viewer"
        | "content_writer"
      cadence: "weekly" | "monthly"
      carry_reason:
        | "deadline"
        | "setup_time"
        | "too_short_live"
        | "awaiting_approval"
        | "other"
      change_type:
        | "budget"
        | "creative"
        | "targeting"
        | "bidding"
        | "landing_page"
        | "tracking"
        | "structure"
        | "other"
      check_status: "green" | "amber" | "red" | "na"
      hypothesis_outcome: "proven" | "disproven" | "inconclusive"
      notion_page_type: "brief" | "action" | "other"
      platform: "linkedin" | "google_ads" | "meta" | "reddit"
      sprint_item_kind:
        | "hypothesis"
        | "learning"
        | "mitigation"
        | "action"
        | "carried"
      sprint_item_status: "open" | "done" | "dropped"
      team_role: "gtm_lead" | "am" | "specialist"
      test_outcome: "proven" | "disproven" | "inconclusive" | "carried"
      test_status:
        | "planned"
        | "briefed"
        | "ready"
        | "live"
        | "review"
        | "closed"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
        "gtm_lead",
        "am",
        "specialist",
        "viewer",
        "content_writer",
      ],
      cadence: ["weekly", "monthly"],
      carry_reason: [
        "deadline",
        "setup_time",
        "too_short_live",
        "awaiting_approval",
        "other",
      ],
      change_type: [
        "budget",
        "creative",
        "targeting",
        "bidding",
        "landing_page",
        "tracking",
        "structure",
        "other",
      ],
      check_status: ["green", "amber", "red", "na"],
      hypothesis_outcome: ["proven", "disproven", "inconclusive"],
      notion_page_type: ["brief", "action", "other"],
      platform: ["linkedin", "google_ads", "meta", "reddit"],
      sprint_item_kind: [
        "hypothesis",
        "learning",
        "mitigation",
        "action",
        "carried",
      ],
      sprint_item_status: ["open", "done", "dropped"],
      team_role: ["gtm_lead", "am", "specialist"],
      test_outcome: ["proven", "disproven", "inconclusive", "carried"],
      test_status: ["planned", "briefed", "ready", "live", "review", "closed"],
    },
  },
} as const
