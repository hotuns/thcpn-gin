package sms

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	dypnsapi "github.com/alibabacloud-go/dypnsapi-20170525/v3/client"
	"github.com/alibabacloud-go/tea/dara"

	"thcpn-gin/internal/apperr"
)

type fakeAliyunClient struct {
	sendRequest  *dypnsapi.SendSmsVerifyCodeRequest
	checkRequest *dypnsapi.CheckSmsVerifyCodeRequest
	sendCode     string
	verifyResult string
	err          error
}

func (f *fakeAliyunClient) SendSmsVerifyCodeWithContext(_ context.Context, request *dypnsapi.SendSmsVerifyCodeRequest, _ *dara.RuntimeOptions) (*dypnsapi.SendSmsVerifyCodeResponse, error) {
	f.sendRequest = request
	if f.err != nil {
		return nil, f.err
	}
	code := f.sendCode
	if code == "" {
		code = "OK"
	}
	return &dypnsapi.SendSmsVerifyCodeResponse{Body: new(dypnsapi.SendSmsVerifyCodeResponseBody).SetCode(code).SetSuccess(code == "OK")}, nil
}

func (f *fakeAliyunClient) CheckSmsVerifyCodeWithContext(_ context.Context, request *dypnsapi.CheckSmsVerifyCodeRequest, _ *dara.RuntimeOptions) (*dypnsapi.CheckSmsVerifyCodeResponse, error) {
	f.checkRequest = request
	if f.err != nil {
		return nil, f.err
	}
	result := f.verifyResult
	if result == "" {
		result = "PASS"
	}
	body := new(dypnsapi.CheckSmsVerifyCodeResponseBody).SetCode("OK").SetSuccess(true).
		SetModel(new(dypnsapi.CheckSmsVerifyCodeResponseBodyModel).SetVerifyResult(result))
	return &dypnsapi.CheckSmsVerifyCodeResponse{Body: body}, nil
}

func TestAliyunSenderBuildsVerificationRequest(t *testing.T) {
	client := &fakeAliyunClient{}
	sender := newAliyunSenderWithClient(client, "THCPN", "SMS_123", "scheme", 300, 60)

	if err := sender.SendVerificationCode(t.Context(), SendRequest{Phone: "13800000000"}); err != nil {
		t.Fatalf("send verification code: %v", err)
	}
	if client.sendRequest == nil {
		t.Fatal("expected aliyun request")
	}
	if got := dara.StringValue(client.sendRequest.PhoneNumber); got != "13800000000" {
		t.Fatalf("expected phone 13800000000, got %q", got)
	}
	if got := dara.StringValue(client.sendRequest.TemplateCode); got != "SMS_123" {
		t.Fatalf("expected template code SMS_123, got %q", got)
	}
	var params map[string]string
	if err := json.Unmarshal([]byte(dara.StringValue(client.sendRequest.TemplateParam)), &params); err != nil {
		t.Fatalf("decode template params: %v", err)
	}
	if params["code"] != "##code##" || params["min"] != "5" {
		t.Fatalf("unexpected template params: %#v", params)
	}
}

func TestAliyunSenderMapsClientAndResponseErrors(t *testing.T) {
	client := &fakeAliyunClient{err: errors.New("network failed")}
	sender := newAliyunSenderWithClient(client, "THCPN", "SMS_123", "", 300, 60)
	if err := sender.SendVerificationCode(t.Context(), SendRequest{Phone: "13800000000"}); apperr.KindOf(err) != apperr.KindInternal {
		t.Fatalf("expected internal client error, got %v", err)
	}

	client.err = nil
	client.sendCode = "isv.BUSINESS_LIMIT_CONTROL"
	if err := sender.SendVerificationCode(t.Context(), SendRequest{Phone: "13800000000"}); apperr.KindOf(err) != apperr.KindInternal {
		t.Fatalf("expected internal response error, got %v", err)
	}
}

func TestAliyunSenderVerifiesCode(t *testing.T) {
	client := &fakeAliyunClient{}
	sender := newAliyunSenderWithClient(client, "THCPN", "SMS_123", "scheme", 300, 60)
	if err := sender.VerifyVerificationCode(t.Context(), VerifyRequest{Phone: "13800000000", Code: "123456"}); err != nil {
		t.Fatalf("verify code: %v", err)
	}
	if got := dara.StringValue(client.checkRequest.VerifyCode); got != "123456" {
		t.Fatalf("expected verification code 123456, got %q", got)
	}

	client.verifyResult = "UNKNOWN"
	if err := sender.VerifyVerificationCode(t.Context(), VerifyRequest{Phone: "13800000000", Code: "000000"}); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}
