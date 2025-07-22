-- Create the trigger function. Note: This function uses the `gen_random_uuid()` function, because postgres doesn't have cuid functionality.
CREATE OR REPLACE FUNCTION create_user_contact_on_user_insert()
RETURNS TRIGGER AS '
BEGIN
    INSERT INTO "UserContact" (
        id,
        "userId",
        "createdAt",
        "updatedAt"
    ) VALUES (
        gen_random_uuid()::text, 
        NEW.id,
        NOW(),
        NOW()
    );
    RETURN NEW;
END;
' LANGUAGE plpgsql;

-- Create the trigger
CREATE OR REPLACE TRIGGER trigger_create_user_contact
    AFTER INSERT ON "User"
    FOR EACH ROW
    EXECUTE FUNCTION create_user_contact_on_user_insert();