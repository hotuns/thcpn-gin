package sms

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	dysmsapi "github.com/alibabacloud-go/dysmsapi-20170525/v4/client"
	"github.com/alibabacloud-go/tea/tea"

	"thcpn-gin/internal/apperr"
)

type fakeAliyunClient struct {
	request *dysmsapi.SendSmsRequest
	code    string
	err     error
}

func (f *fakeAliyunClient) SendSms(request *dysmsapi.SendSmsRequest) (*dysmsapi.SendSmsResponse, error) {
	f.request = request
	if f.err != nil {
		return nil, f.err
	}
	code := f.code
	if code == "" {
		code = "OK"
	}
	return &dysmsapi.SendSmsResponse{
		Body: &dysmsapi.SendSmsResponseBody{
			Code: tea.String(code),
		},
	}, nil
}

func TestAliyunSenderBuildsSendRequest(t *testing.T) {
	client := &fakeAliyunClient{}
	sender := NewAliyunSenderWithClient(client, "THCPN", "SMS_123", "code")

	if err := sender.SendVerificationCode(context.Background(), SendRequest{
		Phone: "13800000000",
		Code:  "123456",
	}); err != nil {
		t.Fatalf("send verification code: %v", err)
	}

	if client.request == nil {
		t.Fatal("expected aliyun request")
	}
	if got := tea.StringValue(client.request.PhoneNumbers); got != "13800000000" {
		t.Fatalf("expected phone 13800000000, got %q", got)
	}
	if got := tea.StringValue(client.request.SignName); got != "THCPN" {
		t.Fatalf("expected sign name THCPN, got %q", got)
	}
	if got := tea.StringValue(client.request.TemplateCode); got != "SMS_123" {
		t.Fatalf("expected template code SMS_123, got %q", got)
	}

	var params map[string]string
	if err := json.Unmarshal([]byte(tea.StringValue(client.request.TemplateParam)), &params); err != nil {
		t.Fatalf("decode template params: %v", err)
	}
	if params["code"] != "123456" {
		t.Fatalf("expected code template param, got %#v", params)
	}
}

func TestAliyunSenderMapsClientError(t *testing.T) {
	client := &fakeAliyunClient{err: errors.New("network failed")}
	sender := NewAliyunSenderWithClient(client, "THCPN", "SMS_123", "code")

	err := sender.SendVerificationCode(context.Background(), SendRequest{Phone: "13800000000", Code: "123456"})
	if apperr.KindOf(err) != apperr.KindInternal {
		t.Fatalf("expected internal error, got %v", err)
	}
}

func TestAliyunSenderMapsNonOKResponse(t *testing.T) {
	client := &fakeAliyunClient{code: "isv.BUSINESS_LIMIT_CONTROL"}
	sender := NewAliyunSenderWithClient(client, "THCPN", "SMS_123", "code")

	err := sender.SendVerificationCode(context.Background(), SendRequest{Phone: "13800000000", Code: "123456"})
	if apperr.KindOf(err) != apperr.KindInternal {
		t.Fatalf("expected internal error, got %v", err)
	}
}
