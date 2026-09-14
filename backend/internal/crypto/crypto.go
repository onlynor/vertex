package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
)

// Cipher 为写入 MySQL 的数据提供 AES-256-GCM 加密：包括 AI 报告正文和
// 设置页填写的 LLM API Key。密钥由 APP_SECRET 派生而来，因此一旦更换
// APP_SECRET，旧数据会明确地失效，而不是被静默解密成乱码。
type Cipher struct {
	aead cipher.AEAD
}

func New(secret string) (*Cipher, error) {
	if secret == "" {
		return nil, errors.New("APP_SECRET 未设置，无法初始化加密模块")
	}
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Cipher{aead: aead}, nil
}

// Encrypt 返回 nonce||ciphertext（随机 nonce 串接密文）。
func (c *Cipher) Encrypt(plaintext []byte) ([]byte, error) {
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return c.aead.Seal(nonce, nonce, plaintext, nil), nil
}

func (c *Cipher) Decrypt(data []byte) ([]byte, error) {
	if len(data) < c.aead.NonceSize() {
		return nil, errors.New("密文长度非法")
	}
	nonce, ciphertext := data[:c.aead.NonceSize()], data[c.aead.NonceSize():]
	return c.aead.Open(nil, nonce, ciphertext, nil)
}

func (c *Cipher) EncryptString(s string) (string, error) {
	sealed, err := c.Encrypt([]byte(s))
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func (c *Cipher) DecryptString(s string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return "", err
	}
	plain, err := c.Decrypt(raw)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}
