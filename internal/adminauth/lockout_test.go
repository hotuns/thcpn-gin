package adminauth

import (
	"testing"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/testdb"
	"time"
)

func TestExpiredAdminLockStartsNewFailureWindow(t *testing.T) {
	db := testdb.Open(t, 0)
	id := testdb.Admin(t, db)
	_, err := db.Exec(t.Context(), `UPDATE system_admins SET failed_attempts=6,locked_until=now()-interval '1 minute' WHERE id=$1`, id)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(db, nil, time.Minute, time.Hour, config.PasswordConfig{})
	for attempt := 1; attempt <= 5; attempt++ {
		_, err := service.Login(t.Context(), LoginInput{Email: id.String() + "@example.test", Password: "wrong-password"})
		want := apperr.KindUnauthorized
		if attempt == 5 {
			want = apperr.KindRateLimited
		}
		if apperr.KindOf(err) != want {
			t.Fatalf("attempt %d: %v", attempt, err)
		}
	}
	var attempts int
	if err := db.QueryRow(t.Context(), `SELECT failed_attempts FROM system_admins WHERE id=$1`, id).Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if attempts != 5 {
		t.Fatalf("attempts=%d", attempts)
	}
	_, err = service.Login(t.Context(), LoginInput{Email: id.String() + "@example.test", Password: "wrong-password"})
	if apperr.DetailsOf(err)["reason"] != "ACCOUNT_LOCKED" {
		t.Fatalf("missing retry context: %v", err)
	}
	if err := db.QueryRow(t.Context(), `SELECT failed_attempts FROM system_admins WHERE id=$1`, id).Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if attempts != 5 {
		t.Fatalf("locked attempts changed count to %d", attempts)
	}
}
