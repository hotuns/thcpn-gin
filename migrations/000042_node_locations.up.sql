ALTER TABLE node_profiles
 ADD COLUMN latitude double precision,
 ADD COLUMN longitude double precision,
 ADD CONSTRAINT node_profiles_location CHECK (
  (latitude IS NULL AND longitude IS NULL) OR
  (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
 );
