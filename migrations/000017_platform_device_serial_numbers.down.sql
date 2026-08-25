ALTER TABLE public.devices
    ALTER COLUMN serial_no DROP DEFAULT;

DROP FUNCTION public.next_device_serial_no();
DROP SEQUENCE public.device_serial_no_seq;

COMMENT ON COLUMN public.devices.serial_no IS '平台唯一设备序列号。';
