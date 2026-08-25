CREATE SEQUENCE public.device_serial_no_seq AS bigint START WITH 1;

CREATE FUNCTION public.next_device_serial_no()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
    SELECT 'EC-' || lpad(nextval('public.device_serial_no_seq')::text, 8, '0');
$$;

ALTER TABLE public.devices
    ALTER COLUMN serial_no SET DEFAULT public.next_device_serial_no();

UPDATE public.devices
SET serial_no = 'MIG-' || id::text;

UPDATE public.devices
SET serial_no = public.next_device_serial_no();

COMMENT ON COLUMN public.devices.serial_no IS
    '平台生成的永久设备序列号，格式为 EC-########，与外部数据源标识无关。';
