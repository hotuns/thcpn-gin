CREATE TABLE lorawan_gateway_details (
 device_id uuid PRIMARY KEY REFERENCES devices(id),
 app_key text NOT NULL DEFAULT '',
 eui text NOT NULL DEFAULT '',
 wifi_name text NOT NULL DEFAULT '',
 updated_by uuid REFERENCES system_admins(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
