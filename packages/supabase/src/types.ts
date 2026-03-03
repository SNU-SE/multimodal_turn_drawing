export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            users: {
                Row: {
                    id: string
                    admin_alias: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    admin_alias: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    admin_alias?: string
                    created_at?: string
                }
            }
            room_groups: {
                Row: {
                    id: string
                    name: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    name: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    name?: string
                    created_at?: string
                }
            }
            rooms: {
                Row: {
                    id: string
                    group_id: string
                    code: string | null
                    status: 'pending' | 'playing' | 'completed'
                    player1_invite_code: string | null
                    player2_invite_code: string | null
                    player1_id: string | null
                    player2_id: string | null
                    current_question_index: number
                    turn_state: Json | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    group_id: string
                    code?: string | null
                    status?: 'pending' | 'playing' | 'completed'
                    player1_invite_code?: string | null
                    player2_invite_code?: string | null
                    player1_id?: string | null
                    player2_id?: string | null
                    current_question_index?: number
                    turn_state?: Json | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    group_id?: string
                    code?: string | null
                    status?: 'pending' | 'playing' | 'completed'
                    player1_invite_code?: string | null
                    player2_invite_code?: string | null
                    player1_id?: string | null
                    player2_id?: string | null
                    current_question_index?: number
                    turn_state?: Json | null
                    created_at?: string
                }
            }
            questions: {
                Row: {
                    id: string
                    image_url: string
                    question_type: 'multiple_choice' | 'essay'
                    correct_answer: string | null
                    default_time_limit: number
                    created_at: string
                }
                Insert: {
                    id?: string
                    image_url: string
                    question_type: 'multiple_choice' | 'essay'
                    correct_answer?: string | null
                    default_time_limit?: number
                    created_at?: string
                }
                Update: {
                    id?: string
                    image_url?: string
                    question_type?: 'multiple_choice' | 'essay'
                    correct_answer?: string | null
                    default_time_limit?: number
                    created_at?: string
                }
            }
            room_questions: {
                Row: {
                    id: string
                    room_id: string
                    question_id: string
                    submitted_answer: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    room_id: string
                    question_id: string
                    submitted_answer?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    room_id?: string
                    question_id?: string
                    submitted_answer?: string | null
                    created_at?: string
                }
            }
            canvas_logs: {
                Row: {
                    id: string
                    room_id: string
                    player_id: string
                    action_type: string
                    payload: Json
                    timestamp: string
                }
                Insert: {
                    id?: string
                    room_id: string
                    player_id: string
                    action_type: string
                    payload: Json
                    timestamp?: string
                }
                Update: {
                    id?: string
                    room_id?: string
                    player_id?: string
                    action_type?: string
                    payload?: Json
                    timestamp?: string
                }
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
