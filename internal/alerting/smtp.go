package alerting

import (
	"context"
	"crypto/tls"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strings"

	"thcpn-gin/internal/config"
)

type SMTPSender struct{ config config.SMTPConfig }

func NewSMTPSender(cfg config.SMTPConfig) *SMTPSender { return &SMTPSender{config: cfg} }

func (s *SMTPSender) SendAlert(ctx context.Context, message AlertEmail) error {
	if strings.TrimSpace(s.config.Host) == "" || strings.TrimSpace(s.config.FromAddress) == "" {
		return fmt.Errorf("SMTP host and from address are required")
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	address := net.JoinHostPort(s.config.Host, fmt.Sprint(s.config.Port))
	tlsConfig := &tls.Config{ServerName: s.config.Host, MinVersion: tls.VersionTLS12}
	var client *smtp.Client
	var err error
	if s.config.TLSMode == "tls" {
		var conn net.Conn
		conn, err = tls.Dial("tcp", address, tlsConfig)
		if err == nil {
			client, err = smtp.NewClient(conn, s.config.Host)
		}
	} else {
		client, err = smtp.Dial(address)
		if err == nil {
			err = client.StartTLS(tlsConfig)
		}
	}
	if err != nil {
		return err
	}
	defer client.Close()
	if s.config.Username != "" {
		if err = client.Auth(smtp.PlainAuth("", s.config.Username, s.config.Password, s.config.Host)); err != nil {
			return err
		}
	}
	if err = client.Mail(s.config.FromAddress); err != nil {
		return err
	}
	if err = client.Rcpt(message.To); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	from := mail.Address{Name: s.config.FromName, Address: s.config.FromAddress}
	subject := mime.QEncoding.Encode("UTF-8", message.Subject)
	body := fmt.Sprintf("%s\n\n%s\n\n%s", message.Title, message.Content, message.ActionURL)
	if _, err = fmt.Fprintf(writer, "From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s", from.String(), message.To, subject, body); err != nil {
		return err
	}
	return writer.Close()
}
