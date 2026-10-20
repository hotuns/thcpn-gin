package platform

import "time"

// These source schemas use contemporary UTC+8 wall-clock DATETIME/DATE values,
// not UTC instants. A fixed location also works in minimal images without tzdata.
var LegacySourceLocation = time.FixedZone("Asia/Shanghai", 8*60*60)
