package config

import (
	"bufio"
	"os"
	"strings"
)

// LoadDotEnv 把 .env 文件中简单的 KEY=VALUE 行读入进程环境变量。
// 已存在的环境变量优先级更高，这样真实部署时可以直接用环境变量覆盖文件内容，
// 而不必修改文件本身。文件不存在也不算错误——仅靠环境变量也能完成应用配置。
func LoadDotEnv(path string) error {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, value)
		}
	}
	return scanner.Err()
}
