package apperr

// LimitExceeded carries public product constraints, not underlying database errors.
func LimitExceeded(field string, maximum, actual int64, unit string) error {
	return &Error{Kind: KindInvalidArgument, Message: "request limit exceeded", Details: map[string]any{
		"reason": "LIMIT_EXCEEDED", "field": field, "maximum": maximum, "actual": actual, "unit": unit,
	}}
}

func PlanHistoryLimit(field string, days int) error {
	return &Error{Kind: KindPermissionDenied, Message: "plan history window exceeded", Details: map[string]any{
		"reason": "LIMIT_EXCEEDED", "field": field, "maximum": days, "unit": "days",
	}}
}

func PasswordLength(minimum, maximum int) error {
	return &Error{Kind: KindInvalidArgument, Message: "invalid password length", Details: map[string]any{
		"reason": "PASSWORD_LENGTH", "minimum": minimum, "maximum": maximum, "unit": "bytes",
	}}
}

func VerificationLimit(channel, period string, maximum int) error {
	return &Error{Kind: KindRateLimited, Message: "verification code limit exceeded", Details: map[string]any{
		"reason": "VERIFICATION_LIMIT", "channel": channel, "period": period, "maximum": maximum,
	}}
}
