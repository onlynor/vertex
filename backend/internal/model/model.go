package model

import "time"

// Teacher 既是管理员账号也是普通教师账号所在的表，通过 role 字段区分两者。
type Teacher struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Username     string    `gorm:"size:64;uniqueIndex;not null" json:"username"`
	PasswordHash string    `gorm:"size:255;not null" json:"-"`
	Name         string    `gorm:"size:64;not null" json:"name"`
	Role         string    `gorm:"size:16;not null;default:teacher" json:"role"` // 角色：admin（管理员）或 teacher（教师）
	Phone        string    `gorm:"size:32" json:"phone"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type Student struct {
	ID        uint   `gorm:"primaryKey" json:"id"`
	Name      string `gorm:"size:64;not null" json:"name"`
	StudentNo string `gorm:"size:64;index" json:"student_no"`
	ClassName string `gorm:"size:64" json:"class_name"`
	Gender    string `gorm:"size:8" json:"gender"`
	Age       int    `json:"age"`
	// 场上位置：前锋 / 中场 / 后卫 / 门将，决定能力分析使用哪一组六维指标；可为空。
	Position  string    `gorm:"size:16" json:"position"`
	TeacherID uint      `gorm:"index" json:"teacher_id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type VideoStatus string

const (
	StatusPending    VideoStatus = "pending"
	StatusProcessing VideoStatus = "processing"
	StatusDone       VideoStatus = "done"
	StatusFailed     VideoStatus = "failed"
)

// Video 对应一次训练视频分析任务。AI 报告本身以 AES-GCM 加密后存放在
// ResultCipher 中，绝不以明文保存，只在向已认证教师返回时才解密。
type Video struct {
	ID           uint        `gorm:"primaryKey" json:"id"`
	TaskID       string      `gorm:"size:64;uniqueIndex;not null" json:"task_id"`
	StudentID    uint        `gorm:"index" json:"student_id"`
	TeacherID    uint        `gorm:"index" json:"teacher_id"`
	Filename     string      `gorm:"size:255" json:"filename"`
	SizeBytes    int64       `json:"size_bytes"`
	DurationSec  float64     `json:"duration_sec"`
	TrainingType string      `gorm:"size:32" json:"training_type"`
	Status       VideoStatus `gorm:"size:16;index;not null" json:"status"`
	ResultCipher []byte      `gorm:"type:blob" json:"-"`
	// 保存一帧采样画面作为报告的封面图。封面包含学生的人像，因此加密存储。
	ThumbCipher []byte `gorm:"type:mediumblob" json:"-"`
	// 原始视频在磁盘上的存放路径。视频会被保留供教师回放；
	// 当容量回收淘汰该文件时，StoredPath 会被清空。
	StoredPath  string     `gorm:"size:512" json:"-"`
	VideoStored bool       `gorm:"not null;default:false" json:"video_stored"`
	ErrorMsg    string     `gorm:"size:255" json:"error_msg,omitempty"`
	CreatedAt   time.Time  `gorm:"index" json:"created_at"`
	CompletedAt *time.Time `json:"completed_at"`

	Student *Student `gorm:"foreignKey:StudentID" json:"student,omitempty"`
}

// Setting 存放从网页界面写入的运行时配置。标记为 Encrypted 的值（即 LLM API Key）
// 在落库时使用 AES-GCM 加密。
type Setting struct {
	Key       string    `gorm:"size:64;primaryKey" json:"key"`
	Value     string    `gorm:"type:text" json:"value"`
	Encrypted bool      `json:"encrypted"`
	UpdatedAt time.Time `json:"updated_at"`
}

// EvaluationSheet 是一张课堂评价表：一节课的技能评价、一场比赛的记录、一个月的汇总、
// 一个阶段的分层任务或一个学期的总评，字段定义见 internal/evaluation。
// 表头信息明文存放以便筛选；学生的逐项评价和评语属于个人评价数据，加密存放在 EvaluationEntry 中。
type EvaluationSheet struct {
	ID          uint   `gorm:"primaryKey" json:"id"`
	TeacherID   uint   `gorm:"index" json:"teacher_id"`
	Kind        string `gorm:"size:16;index;not null" json:"kind"`
	ClassName   string `gorm:"size:64;index" json:"class_name"`
	Title       string `gorm:"size:128" json:"title"`
	LessonDate  string `gorm:"size:10;index" json:"lesson_date"` // YYYY-MM-DD
	TeacherName string `gorm:"size:64" json:"teacher_name"`
	// 以下计数随每次保存更新，列表页不必逐行解密就能显示完成进度。
	StudentCount   int `json:"student_count"`
	RecordedCount  int `json:"recorded_count"`
	CommentedCount int `json:"commented_count"`
	// 表头附加信息（JSON）：分层评价的练习项目和达标线、期中期末的统计区间、记录方式。
	Options string `gorm:"type:text" json:"-"`
	// AI 生成（老师可修改）的课堂总评，加密存放。
	SummaryCipher []byte    `gorm:"type:blob" json:"-"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// EvaluationEntry 是评价表中的一行：一名学生在这张表上的各项评价与评语。
type EvaluationEntry struct {
	ID        uint `gorm:"primaryKey" json:"id"`
	SheetID   uint `gorm:"uniqueIndex:idx_eval_sheet_student,priority:1;not null" json:"sheet_id"`
	StudentID uint `gorm:"uniqueIndex:idx_eval_sheet_student,priority:2;index;not null" json:"student_id"`
	// 学生姓名快照：学生档案被删除后，历史评价表仍能显示是谁。
	StudentName  string `gorm:"size:64" json:"student_name"`
	SortOrder    int    `json:"sort_order"`
	ValuesCipher []byte `gorm:"type:blob" json:"-"`
	// 评语来源：ai 表示由 AI 生成且未改动，manual 表示老师填写或修改过。
	CommentCipher []byte `gorm:"type:blob" json:"-"`
	CommentSource string `gorm:"size:8" json:"comment_source"`
	// AIFields 是「AI 一键评价」填出来、老师还没改过的评价项键名（逗号分隔），
	// 界面上据此把 AI 填的格子和老师自己填的区分开。键名不涉及个人信息，明文存放。
	AIFields  string    `gorm:"size:255" json:"-"`
	UpdatedAt time.Time `json:"updated_at"`
}

// AnalysisReport 是每条视频记录保存的（加密）结构化 AI 输出。
type AnalysisReport struct {
	// 模型判断出的本次训练内容。训练项目按每条视频识别出来，而不是事先假定，
	// 因为教师上传的不只是颠球。
	TrainingType string   `json:"training_type"`
	Summary      string   `json:"summary"`
	Performance  string   `json:"performance"`
	Level        string   `json:"level"`  // 优秀 | 良好 | 一般 | 待提升
	Rating       int      `json:"rating"` // 1~5，把定性档位映射为星级
	Highlights   []string `json:"highlights"`
	Issues       []string `json:"issues"`
	Suggestions  []string `json:"suggestions"`
}
