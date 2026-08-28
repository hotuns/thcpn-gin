package sms

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"strconv"
	"strings"

	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/utils"
	dypnsapi "github.com/alibabacloud-go/dypnsapi-20170525/v3/client"
	"github.com/alibabacloud-go/tea/dara"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

const defaultAliyunTemplateCode = "100001"

type AliyunClient interface {
	SendSmsVerifyCodeWithContext(context.Context, *dypnsapi.SendSmsVerifyCodeRequest, *dara.RuntimeOptions) (*dypnsapi.SendSmsVerifyCodeResponse, error)
	CheckSmsVerifyCodeWithContext(context.Context, *dypnsapi.CheckSmsVerifyCodeRequest, *dara.RuntimeOptions) (*dypnsapi.CheckSmsVerifyCodeResponse, error)
}

type AliyunSender struct {
	client          AliyunClient
	signName        string
	templateCode    string
	schemeName      string
	codeTTLSeconds  int64
	cooldownSeconds int64
}

func NewAliyunSender(cfg config.SMSConfig) (*AliyunSender, error) {
	accessKeyID := strings.TrimSpace(os.Getenv(cfg.Aliyun.AccessKeyIDEnv))
	accessKeySecret := strings.TrimSpace(os.Getenv(cfg.Aliyun.AccessKeySecretEnv))
	signName := strings.TrimSpace(os.Getenv(cfg.Aliyun.SignNameEnv))
	templateCode := strings.TrimSpace(os.Getenv(cfg.Aliyun.TemplateCodeEnv))
	if templateCode == "" {
		templateCode = defaultAliyunTemplateCode
	}
	schemeName := strings.TrimSpace(os.Getenv(cfg.Aliyun.SchemeNameEnv))
	if accessKeyID == "" || accessKeySecret == "" || signName == "" {
		return nil, apperr.New(apperr.KindInvalidArgument, "aliyun sms access key and sign name are required")
	}

	client, err := dypnsapi.NewClient(&openapi.Config{
		AccessKeyId:     dara.String(accessKeyID),
		AccessKeySecret: dara.String(accessKeySecret),
		Endpoint:        dara.String(cfg.Aliyun.Endpoint),
	})
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "create aliyun sms verification client", err)
	}
	return newAliyunSenderWithClient(client, signName, templateCode, schemeName, cfg.CodeTTLSeconds, cfg.CooldownSeconds), nil
}

func newAliyunSenderWithClient(client AliyunClient, signName, templateCode, schemeName string, codeTTLSeconds, cooldownSeconds int) *AliyunSender {
	return &AliyunSender{
		client:          client,
		signName:        signName,
		templateCode:    templateCode,
		schemeName:      schemeName,
		codeTTLSeconds:  int64(codeTTLSeconds),
		cooldownSeconds: int64(cooldownSeconds),
	}
}

func (s *AliyunSender) SendVerificationCode(ctx context.Context, req SendRequest) error {
	if s.client == nil {
		return apperr.New(apperr.KindInternal, "aliyun sms client is not configured")
	}
	templateParam, err := json.Marshal(map[string]string{
		"code": "##code##",
		"min":  verificationMinutes(s.codeTTLSeconds),
	})
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "encode aliyun sms template param", err)
	}

	templateCode := strings.TrimSpace(req.TemplateCode)
	if templateCode == "" {
		templateCode = s.templateCode
	}
	request := new(dypnsapi.SendSmsVerifyCodeRequest).
		SetPhoneNumber(req.Phone).
		SetCountryCode("86").
		SetSignName(s.signName).
		SetTemplateCode(templateCode).
		SetTemplateParam(string(templateParam)).
		SetCodeType(1).
		SetCodeLength(6).
		SetValidTime(s.codeTTLSeconds).
		SetInterval(s.cooldownSeconds).
		SetDuplicatePolicy(1).
		SetReturnVerifyCode(false)
	if s.schemeName != "" {
		request.SetSchemeName(s.schemeName)
	}
	response, err := s.client.SendSmsVerifyCodeWithContext(ctx, request, &dara.RuntimeOptions{})
	if err != nil {
		slog.ErrorContext(ctx, "aliyun sms verification send failed", "error", err)
		return apperr.Wrap(apperr.KindInternal, "send aliyun sms verification code", err)
	}
	if response == nil || response.Body == nil || dara.StringValue(response.Body.Code) != "OK" || !dara.BoolValue(response.Body.Success) {
		return apperr.New(apperr.KindInternal, "aliyun sms verification send failed")
	}
	return nil
}

func (s *AliyunSender) VerifyVerificationCode(ctx context.Context, req VerifyRequest) error {
	if s.client == nil {
		return apperr.New(apperr.KindInternal, "aliyun sms client is not configured")
	}
	request := new(dypnsapi.CheckSmsVerifyCodeRequest).
		SetPhoneNumber(req.Phone).
		SetCountryCode("86").
		SetVerifyCode(req.Code)
	if s.schemeName != "" {
		request.SetSchemeName(s.schemeName)
	}
	response, err := s.client.CheckSmsVerifyCodeWithContext(ctx, request, &dara.RuntimeOptions{})
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "check aliyun sms verification code", err)
	}
	if response == nil || response.Body == nil || dara.StringValue(response.Body.Code) != "OK" || !dara.BoolValue(response.Body.Success) {
		return apperr.New(apperr.KindInternal, "aliyun sms verification check failed")
	}
	if response.Body.Model == nil || dara.StringValue(response.Body.Model.VerifyResult) != "PASS" {
		return apperr.New(apperr.KindInvalidArgument, "invalid or expired sms code")
	}
	return nil
}

func verificationMinutes(seconds int64) string {
	minutes := seconds / 60
	if minutes < 1 {
		minutes = 1
	}
	return strconv.FormatInt(minutes, 10)
}
