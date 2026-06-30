package sms

import (
	"context"
	"encoding/json"
	"os"
	"strings"

	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/client"
	dysmsapi "github.com/alibabacloud-go/dysmsapi-20170525/v4/client"
	"github.com/alibabacloud-go/tea/tea"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

type AliyunClient interface {
	SendSms(request *dysmsapi.SendSmsRequest) (*dysmsapi.SendSmsResponse, error)
}

type AliyunSender struct {
	client               AliyunClient
	signName             string
	templateCode         string
	templateParamCodeKey string
}

func NewAliyunSender(cfg config.SMSConfig) (*AliyunSender, error) {
	accessKeyID := strings.TrimSpace(os.Getenv(cfg.Aliyun.AccessKeyIDEnv))
	accessKeySecret := strings.TrimSpace(os.Getenv(cfg.Aliyun.AccessKeySecretEnv))
	signName := strings.TrimSpace(os.Getenv(cfg.Aliyun.SignNameEnv))
	templateCode := strings.TrimSpace(os.Getenv(cfg.Aliyun.TemplateCodeEnv))

	if accessKeyID == "" || accessKeySecret == "" || signName == "" || templateCode == "" {
		return nil, apperr.New(apperr.KindInvalidArgument, "aliyun sms environment variables are required")
	}

	client, err := dysmsapi.NewClient(&openapi.Config{
		AccessKeyId:     tea.String(accessKeyID),
		AccessKeySecret: tea.String(accessKeySecret),
		Endpoint:        tea.String(cfg.Aliyun.Endpoint),
	})
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "create aliyun sms client", err)
	}

	return &AliyunSender{
		client:               client,
		signName:             signName,
		templateCode:         templateCode,
		templateParamCodeKey: cfg.TemplateParamCodeKey,
	}, nil
}

func NewAliyunSenderWithClient(client AliyunClient, signName string, templateCode string, templateParamCodeKey string) *AliyunSender {
	return &AliyunSender{
		client:               client,
		signName:             signName,
		templateCode:         templateCode,
		templateParamCodeKey: templateParamCodeKey,
	}
}

func (s *AliyunSender) SendVerificationCode(ctx context.Context, req SendRequest) error {
	if s.client == nil {
		return apperr.New(apperr.KindInternal, "aliyun sms client is not configured")
	}

	templateParam, err := json.Marshal(map[string]string{s.templateParamCodeKey: req.Code})
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "encode aliyun sms template param", err)
	}

	response, err := s.client.SendSms(&dysmsapi.SendSmsRequest{
		PhoneNumbers:  tea.String(req.Phone),
		SignName:      tea.String(s.signName),
		TemplateCode:  tea.String(s.templateCode),
		TemplateParam: tea.String(string(templateParam)),
	})
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "send aliyun sms", err)
	}
	if response == nil || response.Body == nil || response.Body.Code == nil || *response.Body.Code != "OK" {
		return apperr.New(apperr.KindInternal, "aliyun sms send failed")
	}

	_ = ctx
	return nil
}
