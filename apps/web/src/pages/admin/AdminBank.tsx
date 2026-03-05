import { useEffect, useState, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { getMyProfile } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Upload, Trash2, Loader2, Image as ImageIcon, Check, X, ClipboardPaste, Pencil } from "lucide-react"
import type { Database } from "@turn-based-drawing/supabase"
import { logger } from "@/lib/logger"

type QuestionRow = Database['public']['Tables']['questions']['Row']

// Upload a file to Supabase Storage and return its public URL
const uploadImage = async (file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop()
    const fileName = `${crypto.randomUUID()}.${fileExt}`
    const filePath = `images/${fileName}`
    const { error } = await supabase.storage.from('questions').upload(filePath, file)
    if (error) throw error
    const { data: { publicUrl } } = supabase.storage.from('questions').getPublicUrl(filePath)
    return publicUrl
}

// Delete a file from Supabase Storage by its public URL
const deleteStorageFile = async (url: string) => {
    const pathParts = url.split('/')
    const fileName = pathParts.pop()
    const folder = pathParts.pop()
    if (fileName && folder) {
        await supabase.storage.from('questions').remove([`${folder}/${fileName}`])
    }
}

// Reusable image upload area component
function ImageUploadArea({
    label,
    previewUrl,
    onFileSelect,
    onPaste,
    onClear,
}: {
    label: string
    previewUrl: string | null
    onFileSelect: (file: File) => void
    onPaste: (e: React.ClipboardEvent) => void
    onClear: () => void
}) {
    const inputRef = useRef<HTMLInputElement>(null)

    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            {previewUrl ? (
                <div className="relative w-full max-w-xs">
                    <img src={previewUrl} alt="Preview" className="rounded-md border max-h-48 object-contain w-full" />
                    <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={onClear}
                    >
                        <X className="w-3 h-3" />
                    </Button>
                </div>
            ) : (
                <div
                    className="border-2 border-dashed rounded-md p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors"
                    onClick={() => inputRef.current?.click()}
                    onPaste={onPaste}
                    tabIndex={0}
                >
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Upload className="w-6 h-6" />
                        <span className="text-sm">클릭하여 파일 선택</span>
                        <span className="text-xs flex items-center gap-1">
                            <ClipboardPaste className="w-3 h-3" />
                            또는 여기에 이미지 붙여넣기 (Ctrl+V)
                        </span>
                    </div>
                </div>
            )}
            <input
                type="file"
                accept="image/*"
                hidden
                ref={inputRef}
                onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) onFileSelect(file)
                    if (inputRef.current) inputRef.current.value = ""
                }}
            />
        </div>
    )
}

export default function AdminBank() {
    const [questions, setQuestions] = useState<QuestionRow[]>([])
    const [isSubmitting, setIsSubmitting] = useState(false)
    const formRef = useRef<HTMLDivElement>(null)

    // Edit mode
    const [editingId, setEditingId] = useState<string | null>(null)

    // Form state
    const [title, setTitle] = useState("")
    const [qType, setQType] = useState<"multiple_choice" | "essay">("essay")
    const [content, setContent] = useState("")
    const [contentImageFile, setContentImageFile] = useState<File | null>(null)
    const [contentImagePreview, setContentImagePreview] = useState<string | null>(null)
    const [imageFile, setImageFile] = useState<File | null>(null)
    const [imagePreview, setImagePreview] = useState<string | null>(null)
    const [answer, setAnswer] = useState("")
    const [options, setOptions] = useState<string[]>(["", "", "", ""])
    const [mcAnswers, setMcAnswers] = useState<string[]>([])

    const fetchQuestions = async () => {
        logger.info("Fetching questions...")
        const profile = await getMyProfile()
        if (!profile) return

        let query = (supabase as any).from('questions').select('*').order('created_at', { ascending: false })
        if (profile.role !== 'super_admin') {
            query = query.eq('org_id', profile.org_id)
        }

        const { data } = await query
        if (data) setQuestions(data as QuestionRow[])
    }

    useEffect(() => {
        fetchQuestions()
    }, [])

    // Clipboard paste handler for image upload areas
    const handlePaste = (e: React.ClipboardEvent, target: 'content' | 'question') => {
        const items = e.clipboardData?.items
        if (!items) return
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile()
                if (file) {
                    const preview = URL.createObjectURL(file)
                    if (target === 'content') {
                        setContentImageFile(file)
                        setContentImagePreview(preview)
                    } else {
                        setImageFile(file)
                        setImagePreview(preview)
                    }
                }
                e.preventDefault()
                break
            }
        }
    }

    const resetForm = () => {
        setEditingId(null)
        setTitle("")
        setContent("")
        setContentImageFile(null)
        setContentImagePreview(null)
        setImageFile(null)
        setImagePreview(null)
        setAnswer("")
        setOptions(["", "", "", ""])
        setMcAnswers([])
    }

    const startEdit = (q: QuestionRow) => {
        setEditingId(q.id)
        setTitle(q.title || "")
        setQType(q.question_type as "essay" | "multiple_choice")
        setContent(q.content || "")
        setContentImageFile(null)
        setContentImagePreview(q.content_image_url || null)
        setImageFile(null)
        setImagePreview(q.image_url || null)
        if (q.question_type === 'essay') {
            setAnswer(q.correct_answer || "")
            setOptions(["", "", "", ""])
            setMcAnswers([])
        } else {
            setAnswer("")
            setOptions((q.options as string[]) || ["", "", "", ""])
            setMcAnswers(q.correct_answer?.split(',') || [])
        }
        formRef.current?.scrollIntoView({ behavior: 'smooth' })
    }

    const handleSubmit = async () => {
        // Validation
        if (!title.trim()) {
            alert("문제 제목을 입력해주세요.")
            return
        }
        const hasContentImage = contentImageFile || (editingId && contentImagePreview)
        if (!content.trim() && !hasContentImage) {
            alert("문항 내용(텍스트 또는 이미지)을 입력해주세요.")
            return
        }
        if (qType === 'essay' && !answer.trim()) {
            alert("정답을 입력해주세요.")
            return
        }
        if (qType === 'multiple_choice') {
            if (options.some(opt => !opt.trim())) {
                alert("객관식 보기를 모두 입력해주세요.")
                return
            }
            if (mcAnswers.length === 0) {
                alert("객관식 정답을 최소 하나 이상 선택해주세요.")
                return
            }
        }

        setIsSubmitting(true)
        try {
            const existingQuestion = editingId ? questions.find(q => q.id === editingId) : null

            // Upload new images if file was changed
            let contentImageUrl: string | null = contentImagePreview
            let imageUrl: string | null = imagePreview

            if (contentImageFile) {
                // Delete old content image if replacing
                if (existingQuestion?.content_image_url) {
                    await deleteStorageFile(existingQuestion.content_image_url)
                }
                contentImageUrl = await uploadImage(contentImageFile)
            } else if (editingId && !contentImagePreview && existingQuestion?.content_image_url) {
                // Image was cleared
                await deleteStorageFile(existingQuestion.content_image_url)
                contentImageUrl = null
            }

            if (imageFile) {
                if (existingQuestion?.image_url) {
                    await deleteStorageFile(existingQuestion.image_url)
                }
                imageUrl = await uploadImage(imageFile)
            } else if (editingId && !imagePreview && existingQuestion?.image_url) {
                await deleteStorageFile(existingQuestion.image_url)
                imageUrl = null
            }

            const profile = await getMyProfile()
            if (!profile) return

            const payload = {
                title: title.trim(),
                content: content.trim() || null,
                content_image_url: contentImageUrl,
                image_url: imageUrl,
                question_type: qType,
                options: qType === 'multiple_choice' ? options : null,
                correct_answer: qType === 'multiple_choice' ? mcAnswers.sort().join(',') : answer.trim(),
                org_id: profile.org_id,
                created_by: profile.id,
            }

            if (editingId) {
                const { error } = await (supabase as any).from('questions').update(payload).eq('id', editingId)
                if (error) throw error
                alert("문제가 성공적으로 수정되었습니다.")
            } else {
                const { error } = await (supabase as any).from('questions').insert(payload)
                if (error) throw error
                alert("문제가 성공적으로 등록되었습니다.")
            }

            resetForm()
            fetchQuestions()
        } catch (err: any) {
            logger.error("Submit failed:", err)
            alert((editingId ? "수정" : "등록") + " 실패: " + err.message)
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleDelete = async (q: QuestionRow) => {
        if (!confirm("정말 이 문제를 삭제하시겠습니까?")) return

        try {
            await (supabase as any).from('questions').delete().eq('id', q.id)

            // Delete images from Storage
            if (q.content_image_url) await deleteStorageFile(q.content_image_url)
            if (q.image_url) await deleteStorageFile(q.image_url)

            fetchQuestions()
        } catch (err) {
            console.error(err)
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">문제 은행</h2>
                <p className="text-muted-foreground">턴제 드로잉 시스템에서 사용할 문제를 등록하고 관리합니다.</p>
            </div>

            <Card ref={formRef} className={`bg-muted/30 ${editingId ? 'ring-2 ring-primary' : ''}`}>
                <CardContent className="pt-6">
                    <div className="flex flex-col gap-6">

                        {/* Edit mode header */}
                        {editingId && (
                            <div className="flex items-center justify-between bg-primary/10 -mx-6 -mt-6 px-6 py-3 rounded-t-lg">
                                <span className="text-sm font-medium text-primary">문제 수정 중...</span>
                                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetForm}>
                                    취소
                                </Button>
                            </div>
                        )}

                        {/* Section 1: Title + Type */}
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
                                    setAnswer("")
                                    setMcAnswers([])
                                }}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="essay">주관식</SelectItem>
                                        <SelectItem value="multiple_choice">객관식</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Section 2: Question Content (text or image) */}
                        <div className="p-4 bg-background rounded-md border space-y-4">
                            <Label className="text-base font-semibold">문항 질문 내용</Label>
                            <p className="text-xs text-muted-foreground -mt-2">원하는 문제 질문을 입력합니다. 텍스트와 이미지 모두 입력 가능합니다. 최소 하나는 입력해주세요.</p>

                            <div className="space-y-2">
                                <Label>텍스트 내용</Label>
                                <textarea
                                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    placeholder="문항 질문을 입력하세요 (예: 다음 그림에서 보이는 과일의 이름은?)"
                                    value={content}
                                    onChange={(e) => setContent(e.target.value)}
                                    rows={3}
                                />
                            </div>

                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                <div className="flex-1 h-px bg-border" />
                                <span>또는</span>
                                <div className="flex-1 h-px bg-border" />
                            </div>

                            <ImageUploadArea
                                label="문항 이미지"
                                previewUrl={contentImagePreview}
                                onFileSelect={(file) => {
                                    setContentImageFile(file)
                                    setContentImagePreview(URL.createObjectURL(file))
                                }}
                                onPaste={(e) => handlePaste(e, 'content')}
                                onClear={() => {
                                    setContentImageFile(null)
                                    setContentImagePreview(null)
                                }}
                            />
                        </div>

                        {/* Section 3: Question Image */}
                        <div className="p-4 bg-background rounded-md border space-y-4">
                            <Label className="text-base font-semibold">문제에 사용할 이미지</Label>
                            <p className="text-xs text-muted-foreground -mt-2">제시문 혹은 제시할 이미지를 업로드합니다. (선택 사항)</p>

                            <ImageUploadArea
                                label="문제 이미지"
                                previewUrl={imagePreview}
                                onFileSelect={(file) => {
                                    setImageFile(file)
                                    setImagePreview(URL.createObjectURL(file))
                                }}
                                onPaste={(e) => handlePaste(e, 'question')}
                                onClear={() => {
                                    setImageFile(null)
                                    setImagePreview(null)
                                }}
                            />
                        </div>

                        {/* Section 4: Answer */}
                        <div className="p-4 bg-background rounded-md border space-y-4">
                            <Label className="text-base font-semibold">정답 설정</Label>

                            {qType === 'essay' ? (
                                <div className="space-y-2">
                                    <Label>주관식 정답</Label>
                                    <Input
                                        placeholder="정답을 입력하세요 (예: 사과)"
                                        value={answer}
                                        onChange={(e) => setAnswer(e.target.value)}
                                    />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <Label>객관식 보기 (체크박스로 복수 정답 선택 가능)</Label>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setOptions([...options, ""])}
                                        >
                                            + 보기 추가
                                        </Button>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {options.map((_, idx) => (
                                            <div key={idx} className="flex items-center space-x-2">
                                                <input
                                                    type="checkbox"
                                                    value={String(idx + 1)}
                                                    checked={mcAnswers.includes(String(idx + 1))}
                                                    onChange={(e) => {
                                                        const val = String(idx + 1)
                                                        if (e.target.checked) setMcAnswers([...mcAnswers, val])
                                                        else setMcAnswers(mcAnswers.filter(a => a !== val))
                                                    }}
                                                    className="w-4 h-4 text-primary rounded"
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
                                                {options.length > 2 && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="text-destructive flex-shrink-0"
                                                        onClick={() => {
                                                            const newOpts = options.filter((_, i) => i !== idx)
                                                            setOptions(newOpts)
                                                            setMcAnswers([])
                                                        }}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Submit Button */}
                        <div className="flex gap-2 justify-end">
                            {editingId && (
                                <Button variant="outline" className="h-10 px-8" onClick={resetForm}>
                                    취소
                                </Button>
                            )}
                            <Button
                                className="bg-primary gap-2 h-10 px-8"
                                onClick={handleSubmit}
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : editingId ? <Pencil className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                                {editingId ? '수정' : '등록'}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Question Cards */}
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
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold">{q.title || '제목 없음'}</p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {q.question_type === 'essay' ? '주관식' : '객관식'} | 정답: {q.question_type === 'multiple_choice' ? `${q.correct_answer}번` : q.correct_answer}
                                        </p>
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-8 w-8"
                                            onClick={() => startEdit(q)}
                                        >
                                            <Pencil className="w-4 h-4" />
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            size="icon"
                                            className="h-8 w-8"
                                            onClick={() => handleDelete(q)}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>

                                {/* Content text */}
                                {q.content && (
                                    <p className="text-xs text-muted-foreground truncate" title={q.content}>
                                        {q.content}
                                    </p>
                                )}

                                {/* Content image thumbnail */}
                                {q.content_image_url && (
                                    <img src={q.content_image_url} alt="Content" className="h-12 w-auto object-contain rounded border" />
                                )}

                                {q.question_type === 'multiple_choice' && q.options && (
                                    <div className="flex flex-col gap-1 mt-2 text-xs bg-muted p-2 rounded">
                                        {(q.options as string[]).map((opt, i) => {
                                            const isCorrect = q.correct_answer?.split(',').includes(String(i + 1));
                                            return (
                                                <div key={i} className={isCorrect ? "font-bold text-primary flex items-center gap-1" : "text-muted-foreground flex items-center gap-1"}>
                                                    <span className="w-3">{isCorrect ? <Check className="w-3 h-3" /> : null}</span>
                                                    {i + 1}. {opt}
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
                {questions.length === 0 && (
                    <div className="col-span-full py-12 text-center text-muted-foreground border-2 border-dashed rounded-lg">
                        등록된 문제가 없습니다. 새로운 문제를 등록하세요.
                    </div>
                )}
            </div>
        </div>
    )
}
