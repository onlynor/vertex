package video

import (
	"fmt"
	"log"
	"mime/multipart"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Store 把上传的训练视频保存在磁盘上，方便教师对照报告随时回放。
// 视频按“尽力而为”的方式保留：当目录超过 maxBytes 时淘汰最旧的文件，
// 这样磁盘写满时表现为“最旧的视频丢失”，而不是“新上传开始失败”。
type Store struct {
	dir      string
	maxBytes int64
}

func NewStore(dir string, maxBytes int64) *Store {
	return &Store{dir: dir, maxBytes: maxBytes}
}

func (s *Store) Dir() string { return s.dir }

// Save 以 taskID 派生的文件名保存上传的视频。
func (s *Store) Save(taskID string, header *multipart.FileHeader) (string, error) {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return "", fmt.Errorf("创建视频目录失败: %w", err)
	}

	ext := strings.ToLower(filepath.Ext(header.Filename))
	destPath := filepath.Join(s.dir, taskID+ext)

	src, err := header.Open()
	if err != nil {
		return "", fmt.Errorf("打开上传文件失败: %w", err)
	}
	defer src.Close()

	dst, err := os.Create(destPath)
	if err != nil {
		return "", fmt.Errorf("创建视频文件失败: %w", err)
	}
	defer dst.Close()

	if _, err := dst.ReadFrom(src); err != nil {
		_ = os.Remove(destPath)
		return "", fmt.Errorf("写入视频文件失败: %w", err)
	}

	return destPath, nil
}

// Delete 删除一个已保存的视频，文件已不存在时静默忽略。
func Delete(path string) error {
	if path == "" {
		return nil
	}
	err := os.Remove(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// Enforce 淘汰最旧的视频，直到存储回到容量上限以内。
// 返回被删除的文件路径，方便调用方把这些记录标记为已过期。
func (s *Store) Enforce() []string {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("video store: read dir failed: %v", err)
		}
		return nil
	}

	type item struct {
		path string
		size int64
		mod  int64
	}
	var files []item
	var total int64
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, item{
			path: filepath.Join(s.dir, entry.Name()),
			size: info.Size(),
			mod:  info.ModTime().UnixNano(),
		})
		total += info.Size()
	}

	if total <= s.maxBytes {
		return nil
	}

	sort.Slice(files, func(i, j int) bool { return files[i].mod < files[j].mod })

	var evicted []string
	for _, f := range files {
		if total <= s.maxBytes {
			break
		}
		if err := os.Remove(f.path); err != nil {
			continue
		}
		total -= f.size
		evicted = append(evicted, f.path)
		log.Printf("video store: evicted %s to stay under retention cap", f.path)
	}
	return evicted
}
