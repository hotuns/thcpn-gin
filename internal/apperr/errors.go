package apperr

import (
	"errors"
	"fmt"
	"math"
	"time"
)

type Kind string

const (
	KindInvalidArgument  Kind = "INVALID_ARGUMENT"
	KindUnauthorized     Kind = "UNAUTHORIZED"
	KindPermissionDenied Kind = "PERMISSION_DENIED"
	KindNotFound         Kind = "NOT_FOUND"
	KindConflict         Kind = "CONFLICT"
	KindRateLimited      Kind = "RATE_LIMITED"
	KindDataSource       Kind = "DATA_SOURCE_ERROR"
	KindInternal         Kind = "INTERNAL"
)

type Error struct {
	Kind    Kind
	Message string
	Err     error
	Details map[string]any
}

func New(kind Kind, message string) error {
	return &Error{Kind: kind, Message: message}
}

func Wrap(kind Kind, message string, err error) error {
	return &Error{Kind: kind, Message: message, Err: err}
}

func (e *Error) Error() string {
	if e.Err == nil {
		return e.Message
	}
	return fmt.Sprintf("%s: %v", e.Message, e.Err)
}

func (e *Error) Unwrap() error {
	return e.Err
}

func KindOf(err error) Kind {
	if err == nil {
		return ""
	}

	var appErr *Error
	if errors.As(err, &appErr) {
		return appErr.Kind
	}

	return KindInternal
}

func MessageOf(err error) string {
	if err == nil {
		return ""
	}

	var appErr *Error
	if errors.As(err, &appErr) && appErr.Message != "" {
		return appErr.Message
	}

	return "internal error"
}

// AccountLocked carries only public retry information, never credentials.
func AccountLocked(until, now time.Time) error {
	seconds := int(math.Ceil(until.Sub(now).Seconds()))
	if seconds < 1 {
		seconds = 1
	}
	return &Error{Kind: KindRateLimited, Message: "account is temporarily locked", Details: map[string]any{
		"reason": "ACCOUNT_LOCKED", "retry_after_seconds": seconds, "locked_until": until.UTC().Format(time.RFC3339),
	}}
}

func DetailsOf(err error) map[string]any {
	var appErr *Error
	if errors.As(err, &appErr) {
		return appErr.Details
	}
	return nil
}
