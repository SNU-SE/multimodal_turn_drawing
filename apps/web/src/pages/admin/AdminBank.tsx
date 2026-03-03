import { useEffect, useState, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Upload, Trash2, Loader2, Image as ImageIcon } from "lucide-react"
import type { Database } from "@turn-based-drawing/supabase"
import { logger } from "@/lib/logger"

type QuestionRow = Database['public']['Tables']['questions']['Row']

export default function AdminBank() {
    const [questions, setQuestions] = useState<QuestionRow[]>([])
    const [isUploading, setIsUploading] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)
    const [answer, setAnswer] = useState("")
    const [qType, setQType] = useState<"multiple_choice" | "essay">("essay")

    const fetchQuestions = async () => {
        logger.info("Fetching questions...")
        const { data } = await (supabase as any).from('questions').select('*').order('created_at', { ascending: false })
        if (data) setQuestions(data as QuestionRow[])
    }

    const checkAndCreateBucket = async () => {
        try {
            const { data } = await supabase.storage.getBucket('questions')
            if (!data) {
                await supabase.storage.createBucket('questions', {
                    public: true,
                })
            }
        } catch (e) {
            logger.info("Bucket check failed... attempting create anyway.", e)
            await supabase.storage.createBucket('questions', { public: true })
        }
    }

    useEffect(() => {
        checkAndCreateBucket().then(fetchQuestions)
    }, [])

    const handleUploadClick = () => {
        if (!answer.trim()) {
            alert("정답을 먼저 입력해주세요.")
            return
        }
        fileRef.current?.click()
    }

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setIsUploading(true)
        try {
            const fileExt = file.name.split('.').pop()
            const fileName = `${Math.random()}.${fileExt}`
            const filePath = `images/${fileName}`

            // 1. Upload to Storage
            const { error: uploadError } = await supabase.storage
                .from('questions')
                .upload(filePath, file)

            if (uploadError) throw uploadError

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
                .from('questions')
                .getPublicUrl(filePath)

            // 2. Insert into DB
            const { error: dbError } = await (supabase as any).from('questions').insert({
                image_url: publicUrl,
                correct_answer: answer.trim(),
                question_type: qType,
                default_time_limit: 60
            })

            if (dbError) throw dbError

            alert("문제가 성공적으로 등록되었습니다.")
            setAnswer("")
            fetchQuestions()
        } catch (err: any) {
            logger.error("Upload failed:", err)
            alert("업로드 실패: " + err.message)
        } finally {
            setIsUploading(false)
            if (fileRef.current) fileRef.current.value = ""
        }
    }

    const handleDelete = async (id: string, url: string) => {
        if (!confirm("정말 이 문제를 삭제하시겠습니까?")) return

        try {
            // Delete from DB
            await (supabase as any).from('questions').delete().eq('id', id)

            // Delete from Storage
            const pathParts = url.split('/')
            const fileName = pathParts.pop()
            const folder = pathParts.pop()
            if (fileName && folder) {
                await supabase.storage.from('questions').remove([`${folder}/${fileName}`])
            }

            fetchQuestions()
        } catch (err) {
            console.error(err)
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">문제 은행 (Question Bank)</h2>
                <p className="text-muted-foreground">턴제 드로잉에서 사용할 문제(이미지)와 정답을 등록하고 관리합니다.</p>
            </div>

            <Card className="bg-muted/30">
                <CardContent className="pt-6">
                    <div className="flex flex-col md:flex-row gap-4 items-end">
                        <div className="space-y-2 flex-grow">
                            <Label>문제 유형</Label>
                            <Select value={qType} onValueChange={(val: any) => setQType(val)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="essay">주관식 (Essay)</SelectItem>
                                    <SelectItem value="multiple_choice">객관식 (Multiple Choice)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2 flex-grow">
                            <Label>정답</Label>
                            <Input
                                placeholder="정답을 입력하세요 (예: 사과)"
                                value={answer}
                                onChange={(e) => setAnswer(e.target.value)}
                            />
                        </div>
                        <Button
                            className="bg-primary gap-2 w-full md:w-auto"
                            onClick={handleUploadClick}
                            disabled={isUploading}
                        >
                            {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            이미지 업로드 및 등록
                        </Button>
                        <input
                            type="file"
                            accept="image/*"
                            hidden
                            ref={fileRef}
                            onChange={handleFileChange}
                        />
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {questions.map((q) => (
                    <Card key={q.id} className="overflow-hidden relative group">
                        <div className="aspect-square w-full bg-muted flex items-center justify-center overflow-hidden">
                            {q.image_url ? (
                                <img src={q.image_url} alt="Question" className="object-cover w-full h-full" />
                            ) : (
                                <ImageIcon className="w-8 h-8 text-muted-foreground opacity-50" />
                            )}
                        </div>
                        <CardContent className="p-3">
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="font-semibold text-lg">{q.correct_answer}</p>
                                    <p className="text-xs text-muted-foreground">{q.question_type === 'essay' ? '주관식' : '객관식'}</p>
                                </div>
                                <Button
                                    variant="destructive"
                                    size="icon"
                                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => handleDelete(q.id, q.image_url)}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
                {questions.length === 0 && (
                    <div className="col-span-full py-12 text-center text-muted-foreground border-2 border-dashed rounded-lg">
                        등록된 문제가 없습니다. 새로운 이미지를 업로드하세요.
                    </div>
                )}
            </div>
        </div>
    )
}
