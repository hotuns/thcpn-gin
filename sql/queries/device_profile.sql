-- name: GetDeviceProfile :one
SELECT device_id, description, location_text, updated_by, created_at, updated_at
FROM device_profiles
WHERE device_id = $1;

-- name: UpsertDeviceProfile :one
INSERT INTO device_profiles (device_id, description, location_text, updated_by)
VALUES ($1, $2, $3, $4)
ON CONFLICT (device_id) DO UPDATE
SET description = EXCLUDED.description,
    location_text = EXCLUDED.location_text,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
RETURNING device_id, description, location_text, updated_by, created_at, updated_at;

-- name: GetDeviceProfileSite :one
SELECT s.id, s.name, s.location_text, s.latitude, s.longitude
FROM device_assignments da
JOIN sites s ON s.id = da.site_id
WHERE da.device_id = $1
  AND da.status = 'active';

-- name: ListDeviceProfileImages :many
SELECT id, device_id, object_key, original_filename, content_type, size_bytes, width, height, caption, sort_order, is_cover, uploaded_by, created_at, updated_at, source_url
FROM device_profile_images
WHERE device_id = $1
ORDER BY sort_order, created_at, id;

-- name: CountDeviceProfileImages :one
SELECT count(*)
FROM device_profile_images
WHERE device_id = $1;

-- name: LockDeviceProfileUploads :one
SELECT id
FROM devices
WHERE id = $1
FOR UPDATE;

-- name: CreateDeviceProfileImage :one
INSERT INTO device_profile_images (
    device_id, object_key, original_filename, content_type, size_bytes,
    width, height, caption, sort_order, is_cover, uploaded_by, source_url
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, sqlc.narg(uploaded_by), sqlc.narg(source_url))
RETURNING id, device_id, object_key, original_filename, content_type, size_bytes, width, height, caption, sort_order, is_cover, uploaded_by, created_at, updated_at, source_url;

-- name: GetDeviceProfileImage :one
SELECT id, device_id, object_key, original_filename, content_type, size_bytes, width, height, caption, sort_order, is_cover, uploaded_by, created_at, updated_at, source_url
FROM device_profile_images
WHERE id = $1 AND device_id = $2;

-- name: UpdateDeviceProfileImage :one
UPDATE device_profile_images
SET caption = $3,
    is_cover = $4,
    updated_at = now()
WHERE id = $1 AND device_id = $2
RETURNING id, device_id, object_key, original_filename, content_type, size_bytes, width, height, caption, sort_order, is_cover, uploaded_by, created_at, updated_at, source_url;

-- name: ClearDeviceProfileImageCover :exec
UPDATE device_profile_images
SET is_cover = false,
    updated_at = now()
WHERE device_id = $1 AND is_cover = true;

-- name: SetDeviceProfileImageOrder :exec
UPDATE device_profile_images
SET sort_order = $3,
    updated_at = now()
WHERE id = $1 AND device_id = $2;

-- name: DeleteDeviceProfileImage :one
DELETE FROM device_profile_images
WHERE id = $1 AND device_id = $2
RETURNING id, device_id, object_key, original_filename, content_type, size_bytes, width, height, caption, sort_order, is_cover, uploaded_by, created_at, updated_at, source_url;

-- name: PromoteFirstDeviceProfileImageCover :exec
UPDATE device_profile_images
SET is_cover = true,
    updated_at = now()
WHERE id = (
    SELECT dpi.id
    FROM device_profile_images dpi
    WHERE dpi.device_id = $1
    ORDER BY dpi.sort_order, dpi.created_at, dpi.id
    LIMIT 1
);
