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
    const [title, setTitle] = useState("")
    const [answer, setAnswer] = useState("")
    const [qType, setQType] = useState<"multiple_choice" | "essay">("essay")
    const [options, setOptions] = useState<string[]>(["", "", "", ""])

    const fetchQuestions = async () => {
        logger.info("Fetching questions...")
        const { data } = await (supabase as any).from('questions').select('*').order('created_at', { ascending: false })
        if (data) setQuestions(data as QuestionRow[])
    }

    useEffect(() => {
        fetchQuestions()
    }, [])

    const handleUploadClick = () => {
        if (!title.trim()) {
            alert("문제 제목(이름)을 먼저 입력해주세요.")
            return
        }
        if (qType === 'essay' && !answer.trim()) {
            alert("정답을 먼저 입력해주세요.")
            return
        }
        if (qType === 'multiple_choice') {
            const hasEmptyOption = options.some(opt => !opt.trim())
            if (hasEmptyOption) {
                alert("객관식 보기를 모두 입력해주세요.")
                return
            }
            if (!answer.trim()) {
                alert("객관식 정답(보기 중 하나)을 선택해주세요.")
                return
            }
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
                title: title.trim(),
                image_url: publicUrl,
                correct_answer: answer.trim(),
                question_type: qType,
                options: qType === 'multiple_choice' ? options : null,
                default_time_limit: 60
            })

            if (dbError) throw dbError

            alert("문제가 성공적으로 등록되었습니다.")
            setTitle("")
            setAnswer("")
            setOptions(["", "", "", ""])
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
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col md:flex-row gap-4 items-end">
                            <div className="space-y-2 flex-grow">
                                <Label>문제 제목 (식별용)</Label>
                                <Input
                                    placeholder="어떤 문제인지 적어주세요 (예: 과일 이름 맞추기 1번)"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2 w-full md:w-1/4">
                                <Label>문제 유형</Label>
                                <Select value={qType} onValueChange={(val: any) => {
                                    setQType(val)
                                    setAnswer("") // reset answer when type changes
                                }}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="essay">주관식 (Essay)</SelectItem>
                                        <SelectItem value="multiple_choice">객관식 (Multiple Choice)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* 동적 폼 영역 */}
                        <div className="p-4 bg-background rounded-md border flex flex-col md:flex-row gap-4 items-end">
                            {qType === 'essay' ? (
                                <div className="space-y-2 flex-grow">
                                    <Label>주관식 정답</Label>
                                    <Input
                                        placeholder="정답을 입력하세요 (예: 사과)"
                                        value={answer}
                                        onChange={(e) => setAnswer(e.target.value)}
                                    />
                                </div>
                            ) : (
                                <div className="space-y-4 w-full">
                                    <Label>객관식 보기 (라디오 버튼으로 정답 선택)</Label>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {[0, 1, 2, 3].map((idx) => (
                                            <div key={idx} className="flex items-center space-x-2">
                                                <input
                                                    type="radio"
                                                    name="correct_answer"
                                                    value={String(idx + 1)}
                                                    checked={answer === String(idx + 1)}
                                                    onChange={(e) => setAnswer(e.target.value)}
                                                    className="w-4 h-4 text-primary"
                                                />
                                                <span className="font-bold text-sm w-4">{idx + 1}.</span>
                                                <Input
                                                    placeholder={`보기 ${idx + 1} 내용`}
                                                    value={options[idx]}
                                                    onChange={(e) => {
                                                        const newOpts = [...options]
                                                        newOpts[idx] = e.target.value
                                                        setOptions(newOpts)
                                                    }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <Button
                                className="bg-primary gap-2 h-10 px-8 shrink-0"
                                onClick={handleUploadClick}
                                disabled={isUploading}
                            >
                                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                                업로드 및 등록
                            </Button>
                        </div>

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
                            <div className="flex flex-col gap-2">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="font-semibold">{q.title || '제목 없음'}</p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {q.question_type === 'essay' ? '주관식' : '객관식'} | 정답: {q.question_type === 'multiple_choice' ? `${q.correct_answer}번` : q.correct_answer}
                                        </p>
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

                                {q.question_type === 'multiple_choice' && q.options && (
                                    <div className="grid grid-cols-2 gap-1 mt-2 text-xs bg-muted p-2 rounded">
                                        {(q.options as string[]).map((opt, i) => (
                                            <div key={i} className={String(i + 1) === q.correct_answer ? "font-bold text-primary" : "text-muted-foreground"}>
                                                {i + 1}. {opt}
                                            </div>
                                        ))}
                                    </div>
                                )}
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
