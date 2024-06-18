# Set Up SSO with Google Workspace

Shelf supports single sign-on (SSO) using Google Workspace (formerly known as GSuite).

## Step 1: Open the Google Workspace web and mobile apps console [#](#step-1-open-the-google-workspace-web-and-mobile-apps-console)

![step-1](../../img/google-workspace-step-1.png)

## Step 2: Choose Add custom SAML app [#](#step-2-choose-add-custom-saml-app)

From the _Add app_ button in the toolbar choose _Add custom SAML app_.

![step-2](../../img/google-workspace-step-2.png)

## Step 3: Fill out app details [#](#step-3-fill-out-app-details)

The information you enter here is for visibility into your Google Workspace. You can choose any values you like. Optionally enter a description.

![step-3](../../img/google-workspace-step-3.png)

## Step 4: Download IdP metadata [#](#step-4-download-idp-metadata)

This is a very important step. Click on _DOWNLOAD METADATA_ and save the file that was downloaded.

![step-4](../../img/google-workspace-step-4.png)

It's very important to send this file to your support contact at Supabase to complete the SSO setup process. If you're not sure where to send this file, you can always reach us at [hello@shelf.nu](mailto:hello@shelf.nu).

> [!IMPORTANT]
> Make sure the certificate as shown on screen has at least 1 year before it expires. Mark down this date in your calendar so you will be reminded that you need to update the certificate without any downtime for your users.

## Step 5: Add service provider details [#](#step-5-add-service-provider-details)

Fill out these service provider details on the next screen.

| Detail         | Value                                                                |
| -------------- | -------------------------------------------------------------------- |
| ACS URL        | `https://nmmqcuiasekdacmhwsxk.supabase.co/auth/v1/sso/saml/acs`      |
| Entity ID      | `https://nmmqcuiasekdacmhwsxk.supabase.co/auth/v1/sso/saml/metadata` |
| Name ID format | PERSISTENT                                                           |
| Name ID        | _Basic Information > Primary email_                                  |

![step-5](../../img/google-workspace-step-5.png)

## Step 6: Configure attribute mapping [#](#step-6-configure-attribute-mapping)

Attribute mappings allow Shelf to get information about your Google Workspace users on each login.

All attribute mappings are required. If in doubt, replicate the same config as shown in the screenshot below.
