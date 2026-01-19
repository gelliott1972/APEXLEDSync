@echo off
REM Deploy UniSync infrastructure with custom domain
REM Usage: deploy.bat [--all | stack-name]

setlocal

set DOMAIN_NAME=apex.wrangleit.net
set CERTIFICATE_ARN=arn:aws:acm:us-east-1:726966883566:certificate/ce9d9f3d-7dfe-41b8-a04c-812bddaa1977
set HOSTED_ZONE_ID=Z10166762BQXM65SWNK23
set AWS_PROFILE=AdministratorAccess-726966883566

REM Build backend first
echo Building backend...
cd /d %~dp0..
call pnpm --filter backend build
if errorlevel 1 (
    echo Backend build failed!
    exit /b 1
)

REM Deploy CDK
echo Deploying CDK stacks...
cd /d %~dp0

if "%1"=="" (
    npx cdk deploy --all --require-approval never ^
        --profile %AWS_PROFILE% ^
        -c domainName=%DOMAIN_NAME% ^
        -c certificateArn=%CERTIFICATE_ARN% ^
        -c hostedZoneId=%HOSTED_ZONE_ID%
) else (
    npx cdk deploy %* ^
        --profile %AWS_PROFILE% ^
        -c domainName=%DOMAIN_NAME% ^
        -c certificateArn=%CERTIFICATE_ARN% ^
        -c hostedZoneId=%HOSTED_ZONE_ID%
)

endlocal
