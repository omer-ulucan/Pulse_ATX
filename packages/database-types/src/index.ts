export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      agent_decisions: {
        Row: {
          confidence: number | null;
          created_at: string;
          decision_type: string;
          id: string;
          incident_id: string | null;
          input_context: Json;
          latency_ms: number | null;
          model_name: string;
          output: Json;
          prompt_version: string;
          raw_event_id: string | null;
          retrieved_memory_ids: string[];
        };
        Insert: {
          confidence?: number | null;
          created_at?: string;
          decision_type: string;
          id?: string;
          incident_id?: string | null;
          input_context?: Json;
          latency_ms?: number | null;
          model_name: string;
          output: Json;
          prompt_version: string;
          raw_event_id?: string | null;
          retrieved_memory_ids?: string[];
        };
        Update: {
          confidence?: number | null;
          created_at?: string;
          decision_type?: string;
          id?: string;
          incident_id?: string | null;
          input_context?: Json;
          latency_ms?: number | null;
          model_name?: string;
          output?: Json;
          prompt_version?: string;
          raw_event_id?: string | null;
          retrieved_memory_ids?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "agent_decisions_incident_id_fkey";
            columns: ["incident_id"];
            isOneToOne: false;
            referencedRelation: "incidents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_decisions_raw_event_id_fkey";
            columns: ["raw_event_id"];
            isOneToOne: false;
            referencedRelation: "raw_events";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_health: {
        Row: {
          active_incidents: number;
          heartbeat_interval_seconds: number;
          id: string;
          last_heartbeat_at: string;
          metadata: Json;
          pending_jobs: number;
          status: string;
          updated_at: string;
          worker_id: string;
        };
        Insert: {
          active_incidents?: number;
          heartbeat_interval_seconds: number;
          id?: string;
          last_heartbeat_at?: string;
          metadata?: Json;
          pending_jobs?: number;
          status: string;
          updated_at?: string;
          worker_id: string;
        };
        Update: {
          active_incidents?: number;
          heartbeat_interval_seconds?: number;
          id?: string;
          last_heartbeat_at?: string;
          metadata?: Json;
          pending_jobs?: number;
          status?: string;
          updated_at?: string;
          worker_id?: string;
        };
        Relationships: [];
      };
      agent_timeline: {
        Row: {
          created_at: string;
          event_type: string;
          id: string;
          incident_id: string | null;
          message: string;
          metadata: Json;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          id?: string;
          incident_id?: string | null;
          message: string;
          metadata?: Json;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          id?: string;
          incident_id?: string | null;
          message?: string;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "agent_timeline_incident_id_fkey";
            columns: ["incident_id"];
            isOneToOne: false;
            referencedRelation: "incidents";
            referencedColumns: ["id"];
          },
        ];
      };
      alerts: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          audience: string;
          created_at: string;
          id: string;
          incident_id: string;
          message: string;
          recommended_actions: Json;
          requires_approval: boolean;
          severity: number;
          status: string;
          title: string;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          audience: string;
          created_at?: string;
          id?: string;
          incident_id: string;
          message: string;
          recommended_actions?: Json;
          requires_approval?: boolean;
          severity: number;
          status?: string;
          title: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          audience?: string;
          created_at?: string;
          id?: string;
          incident_id?: string;
          message?: string;
          recommended_actions?: Json;
          requires_approval?: boolean;
          severity?: number;
          status?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "alerts_incident_id_fkey";
            columns: ["incident_id"];
            isOneToOne: false;
            referencedRelation: "incidents";
            referencedColumns: ["id"];
          },
        ];
      };
      demo_scenario_runs: {
        Row: {
          created_at: string;
          id: string;
          nonce: string;
          result: Json;
          scenario: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          nonce: string;
          result: Json;
          scenario: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          nonce?: string;
          result?: Json;
          scenario?: string;
        };
        Relationships: [];
      };
      event_jobs: {
        Row: {
          attempts: number;
          completed_at: string | null;
          created_at: string;
          error: string | null;
          id: string;
          job_type: string;
          locked_at: string | null;
          locked_by: string | null;
          raw_event_id: string;
          raw_event_revision: number;
          status: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          completed_at?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          job_type?: string;
          locked_at?: string | null;
          locked_by?: string | null;
          raw_event_id: string;
          raw_event_revision: number;
          status?: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          completed_at?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          job_type?: string;
          locked_at?: string | null;
          locked_by?: string | null;
          raw_event_id?: string;
          raw_event_revision?: number;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_jobs_raw_event_id_fkey";
            columns: ["raw_event_id"];
            isOneToOne: false;
            referencedRelation: "raw_events";
            referencedColumns: ["id"];
          },
        ];
      };
      incident_events: {
        Row: {
          created_at: string;
          id: string;
          incident_id: string;
          raw_event_id: string;
          relationship_type: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          incident_id: string;
          raw_event_id: string;
          relationship_type: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          incident_id?: string;
          raw_event_id?: string;
          relationship_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "incident_events_incident_id_fkey";
            columns: ["incident_id"];
            isOneToOne: false;
            referencedRelation: "incidents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incident_events_raw_event_id_fkey";
            columns: ["raw_event_id"];
            isOneToOne: false;
            referencedRelation: "raw_events";
            referencedColumns: ["id"];
          },
        ];
      };
      incident_memories: {
        Row: {
          created_at: string;
          embedding: string | null;
          id: string;
          incident_id: string;
          lesson: Json;
          quality_score: number;
          summary: string;
        };
        Insert: {
          created_at?: string;
          embedding?: string | null;
          id?: string;
          incident_id: string;
          lesson: Json;
          quality_score?: number;
          summary: string;
        };
        Update: {
          created_at?: string;
          embedding?: string | null;
          id?: string;
          incident_id?: string;
          lesson?: Json;
          quality_score?: number;
          summary?: string;
        };
        Relationships: [
          {
            foreignKeyName: "incident_memories_incident_id_fkey";
            columns: ["incident_id"];
            isOneToOne: true;
            referencedRelation: "incidents";
            referencedColumns: ["id"];
          },
        ];
      };
      incident_outcomes: {
        Row: {
          actual_duration_minutes: number | null;
          created_at: string;
          id: string;
          incident_id: string;
          observed_severity: number | null;
          outcome: Json;
          predicted_duration_minutes: number | null;
          predicted_severity: number | null;
          prediction_error: number | null;
        };
        Insert: {
          actual_duration_minutes?: number | null;
          created_at?: string;
          id?: string;
          incident_id: string;
          observed_severity?: number | null;
          outcome?: Json;
          predicted_duration_minutes?: number | null;
          predicted_severity?: number | null;
          prediction_error?: number | null;
        };
        Update: {
          actual_duration_minutes?: number | null;
          created_at?: string;
          id?: string;
          incident_id?: string;
          observed_severity?: number | null;
          outcome?: Json;
          predicted_duration_minutes?: number | null;
          predicted_severity?: number | null;
          prediction_error?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "incident_outcomes_incident_id_fkey";
            columns: ["incident_id"];
            isOneToOne: true;
            referencedRelation: "incidents";
            referencedColumns: ["id"];
          },
        ];
      };
      incidents: {
        Row: {
          actual_duration_minutes: number | null;
          confidence: number | null;
          created_at: string;
          ended_at: string | null;
          first_detected_at: string;
          id: string;
          incident_type: string;
          last_updated_at: string;
          latitude: number | null;
          location_name: string | null;
          longitude: number | null;
          predicted_duration_minutes: number | null;
          severity: number | null;
          started_at: string | null;
          status: string;
          summary: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          actual_duration_minutes?: number | null;
          confidence?: number | null;
          created_at?: string;
          ended_at?: string | null;
          first_detected_at?: string;
          id?: string;
          incident_type: string;
          last_updated_at?: string;
          latitude?: number | null;
          location_name?: string | null;
          longitude?: number | null;
          predicted_duration_minutes?: number | null;
          severity?: number | null;
          started_at?: string | null;
          status?: string;
          summary?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          actual_duration_minutes?: number | null;
          confidence?: number | null;
          created_at?: string;
          ended_at?: string | null;
          first_detected_at?: string;
          id?: string;
          incident_type?: string;
          last_updated_at?: string;
          latitude?: number | null;
          location_name?: string | null;
          longitude?: number | null;
          predicted_duration_minutes?: number | null;
          severity?: number | null;
          started_at?: string | null;
          status?: string;
          summary?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      raw_events: {
        Row: {
          created_at: string;
          event_type: string;
          external_id: string;
          fingerprint: string;
          first_seen_at: string;
          id: string;
          last_seen_at: string;
          payload: Json;
          processing_status: string;
          revision: number;
          security_status: string;
          source: string;
          source_created_at: string | null;
          source_updated_at: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          external_id: string;
          fingerprint: string;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          payload: Json;
          processing_status?: string;
          revision?: number;
          security_status?: string;
          source: string;
          source_created_at?: string | null;
          source_updated_at?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          external_id?: string;
          fingerprint?: string;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          payload?: Json;
          processing_status?: string;
          revision?: number;
          security_status?: string;
          source?: string;
          source_created_at?: string | null;
          source_updated_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      security_findings: {
        Row: {
          action_taken: string;
          created_at: string;
          details: Json;
          id: string;
          incident_id: string | null;
          provider: string;
          raw_event_id: string | null;
          severity: string;
          stage: string;
          threat_type: string;
        };
        Insert: {
          action_taken: string;
          created_at?: string;
          details?: Json;
          id?: string;
          incident_id?: string | null;
          provider: string;
          raw_event_id?: string | null;
          severity: string;
          stage: string;
          threat_type: string;
        };
        Update: {
          action_taken?: string;
          created_at?: string;
          details?: Json;
          id?: string;
          incident_id?: string | null;
          provider?: string;
          raw_event_id?: string | null;
          severity?: string;
          stage?: string;
          threat_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "security_findings_incident_id_fkey";
            columns: ["incident_id"];
            isOneToOne: false;
            referencedRelation: "incidents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "security_findings_raw_event_id_fkey";
            columns: ["raw_event_id"];
            isOneToOne: false;
            referencedRelation: "raw_events";
            referencedColumns: ["id"];
          },
        ];
      };
      source_health: {
        Row: {
          etag: string | null;
          id: string;
          items_changed: number;
          items_received: number;
          last_error: string | null;
          last_error_at: string | null;
          last_modified: string | null;
          last_poll_at: string | null;
          last_success_at: string | null;
          latency_ms: number | null;
          source: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          etag?: string | null;
          id?: string;
          items_changed?: number;
          items_received?: number;
          last_error?: string | null;
          last_error_at?: string | null;
          last_modified?: string | null;
          last_poll_at?: string | null;
          last_success_at?: string | null;
          latency_ms?: number | null;
          source: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          etag?: string | null;
          id?: string;
          items_changed?: number;
          items_received?: number;
          last_error?: string | null;
          last_error_at?: string | null;
          last_modified?: string | null;
          last_poll_at?: string | null;
          last_success_at?: string | null;
          latency_ms?: number | null;
          source?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      apply_cross_feed_correlation: {
        Args: {
          p_decision: Json;
          p_incident_id: string;
          p_job_id: string;
          p_worker_id: string;
        };
        Returns: string;
      };
      approve_alert: {
        Args: { p_alert_id: string; p_operator: string };
        Returns: string;
      };
      claim_event_jobs: {
        Args: { p_limit?: number; p_worker_id: string };
        Returns: {
          attempts: number;
          event_type: string;
          job_id: string;
          payload: Json;
          raw_event_id: string;
          raw_event_revision: number;
          source: string;
          source_updated_at: string;
        }[];
      };
      create_or_update_incident_alert: {
        Args: {
          p_audience: string;
          p_incident_id: string;
          p_message: string;
          p_recommended_actions: Json;
          p_requires_approval: boolean;
          p_severity: number;
          p_title: string;
        };
        Returns: string;
      };
      fail_event_job: {
        Args: {
          p_error: string;
          p_job_id: string;
          p_max_attempts?: number;
          p_worker_id: string;
        };
        Returns: string;
      };
      ingest_raw_event: {
        Args: {
          p_event_type: string;
          p_external_id: string;
          p_fingerprint: string;
          p_payload: Json;
          p_source: string;
          p_source_created_at?: string;
          p_source_updated_at?: string;
        };
        Returns: {
          changed: boolean;
          job_id: string;
          raw_event_id: string;
          revision: number;
        }[];
      };
      list_cross_feed_candidates: {
        Args: { p_raw_event_id: string };
        Returns: {
          event_type: string;
          incident_id: string;
          latitude: number;
          location_name: string;
          longitude: number;
          occurred_at: string;
          payload: Json;
          predicted_duration_minutes: number;
          severity: number;
          source: string;
          summary: string;
        }[];
      };
      list_memory_candidates: {
        Args: { p_limit?: number };
        Returns: {
          incident: Json;
          outcome: Json;
        }[];
      };
      match_incident_memories: {
        Args: {
          p_incident_type?: string;
          p_latitude?: number;
          p_limit?: number;
          p_longitude?: number;
          p_query_embedding: string;
          p_time_bucket?: string;
        };
        Returns: {
          combined_score: number;
          incident_id: string;
          lesson: Json;
          memory_id: string;
          similarity: number;
          summary: string;
        }[];
      };
      persist_analysis_result: {
        Args: {
          p_decision: Json;
          p_input_context: Json;
          p_job_id: string;
          p_latency_ms: number;
          p_model_name: string;
          p_prompt_version: string;
          p_used_fallback?: boolean;
          p_worker_id: string;
        };
        Returns: string;
      };
      quarantine_event_job: {
        Args: {
          p_action_taken: string;
          p_details: Json;
          p_job_id: string;
          p_provider: string;
          p_severity: string;
          p_stage: string;
          p_threat_type: string;
          p_worker_id: string;
        };
        Returns: string;
      };
      record_incident_outcome: {
        Args: {
          p_actual_duration_minutes: number;
          p_incident_id: string;
          p_observed_severity: number;
          p_outcome?: Json;
        };
        Returns: string;
      };
      record_runtime_policy_violation: {
        Args: {
          p_binary: string;
          p_destination: string;
          p_details?: Json;
          p_reason: string;
        };
        Returns: string;
      };
      recover_stale_event_jobs: {
        Args: { p_max_attempts?: number; p_stale_before: string };
        Returns: number;
      };
      run_demo_scenario: {
        Args: { p_nonce: string; p_scenario: string };
        Returns: Json;
      };
      store_incident_memory: {
        Args: {
          p_embedding: string;
          p_incident_id: string;
          p_lesson: Json;
          p_quality_score: number;
          p_summary: string;
        };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
