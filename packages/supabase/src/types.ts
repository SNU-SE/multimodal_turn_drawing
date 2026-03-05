export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      canvas_logs: {
        Row: {
          action_type: string
          id: string
          payload: Json
          player_id: string | null
          room_id: string | null
          timestamp: string
        }
        Insert: {
          action_type: string
          id?: string
          payload: Json
          player_id?: string | null
          room_id?: string | null
          timestamp?: string
        }
        Update: {
          action_type?: string
          id?: string
          payload?: Json
          player_id?: string | null
          room_id?: string | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "canvas_logs_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canvas_logs_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          neis_code: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          neis_code: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          neis_code?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          org_id: string
          role: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
          org_id: string
          role: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          org_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          content: string | null
          content_image_url: string | null
          correct_answer: string | null
          created_at: string
          created_by: string | null
          default_time_limit: number | null
          id: string
          image_url: string | null
          options: Json | null
          org_id: string
          question_type: string | null
          title: string | null
        }
        Insert: {
          content?: string | null
          content_image_url?: string | null
          correct_answer?: string | null
          created_at?: string
          created_by?: string | null
          default_time_limit?: number | null
          id?: string
          image_url?: string | null
          options?: Json | null
          org_id: string
          question_type?: string | null
          title?: string | null
        }
        Update: {
          content?: string | null
          content_image_url?: string | null
          correct_answer?: string | null
          created_at?: string
          created_by?: string | null
          default_time_limit?: number | null
          id?: string
          image_url?: string | null
          options?: Json | null
          org_id?: string
          question_type?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "questions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      room_groups: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          org_id: string
          question_ids: string[] | null
          session_time_limit: number | null
          time_limit: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          org_id: string
          question_ids?: string[] | null
          session_time_limit?: number | null
          time_limit?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          org_id?: string
          question_ids?: string[] | null
          session_time_limit?: number | null
          time_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "room_groups_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      room_questions: {
        Row: {
          created_at: string
          id: string
          is_correct: boolean | null
          question_id: string | null
          room_id: string | null
          submitted_answer: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_correct?: boolean | null
          question_id?: string | null
          room_id?: string | null
          submitted_answer?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_correct?: boolean | null
          question_id?: string | null
          room_id?: string | null
          submitted_answer?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_questions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          code: string | null
          created_at: string
          current_question_index: number | null
          group_id: string | null
          id: string
          player1_id: string | null
          player1_invite_code: string | null
          player2_id: string | null
          player2_invite_code: string | null
          status: string | null
          turn_state: Json | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          current_question_index?: number | null
          group_id?: string | null
          id?: string
          player1_id?: string | null
          player1_invite_code?: string | null
          player2_id?: string | null
          player2_invite_code?: string | null
          status?: string | null
          turn_state?: Json | null
        }
        Update: {
          code?: string | null
          created_at?: string
          current_question_index?: number | null
          group_id?: string | null
          id?: string
          player1_id?: string | null
          player1_invite_code?: string | null
          player2_id?: string | null
          player2_invite_code?: string | null
          status?: string | null
          turn_state?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "rooms_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "room_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_player1_id_fkey"
            columns: ["player1_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_player2_id_fkey"
            columns: ["player2_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      turns_log: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          player_id: string | null
          room_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          player_id?: string | null
          room_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          player_id?: string | null
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "turns_log_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turns_log_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          admin_alias: string
          created_at: string
          id: string
        }
        Insert: {
          admin_alias: string
          created_at?: string
          id?: string
        }
        Update: {
          admin_alias?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_my_org_id: { Args: never; Returns: string }
      get_my_role: { Args: never; Returns: string }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

