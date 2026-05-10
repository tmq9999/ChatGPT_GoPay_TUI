fetch("https://chatgpt.com/backend-api/accounts/mfa/enroll", {
    "headers": {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "authorization": "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjE5MzQ0ZTY1LWJiYzktNDRkMS1hOWQwLWY5NTdiMDc5YmQwZSIsInR5cCI6IkpXVCJ9.eyJhdWQiOlsiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MSJdLCJjbGllbnRfaWQiOiJhcHBfWDh6WTZ2VzJwUTl0UjNkRTduSzFqTDVnSCIsImV4cCI6MTc3OTE1MjcxOSwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7ImFtciI6WyJwd2QiXSwiY2hhdGdwdF9hY2NvdW50X2lkIjoiYzU3MDNiNDItNmRjMS00NWU3LWJkOWYtMDdiYjVmMzBiZTYwIiwiY2hhdGdwdF9hY2NvdW50X3VzZXJfaWQiOiJ1c2VyLUpCcUlRa2lVc2FJdWl1QVRvYndka0pZOV9fYzU3MDNiNDItNmRjMS00NWU3LWJkOWYtMDdiYjVmMzBiZTYwIiwiY2hhdGdwdF9jb21wdXRlX3Jlc2lkZW5jeSI6Im5vX2NvbnN0cmFpbnQiLCJjaGF0Z3B0X3BsYW5fdHlwZSI6ImZyZWUiLCJjaGF0Z3B0X3VzZXJfaWQiOiJ1c2VyLUpCcUlRa2lVc2FJdWl1QVRvYndka0pZOSIsInVzZXJfaWQiOiJ1c2VyLUpCcUlRa2lVc2FJdWl1QVRvYndka0pZOSJ9LCJodHRwczovL2FwaS5vcGVuYWkuY29tL3Byb2ZpbGUiOnsiZW1haWwiOiJ0cmFubWluaHF1YW5nLnRtcTk5OTkrMjM5eHZ4Y3Z4djBmamRzQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlfSwiaWF0IjoxNzc4Mjg4NzE4LCJpc3MiOiJodHRwczovL2F1dGgub3BlbmFpLmNvbSIsImp0aSI6IjlkMDY4MTBjLThiYjMtNDYyYy1hZGQwLWIxNTUwZTllMjE4OCIsIm5iZiI6MTc3ODI4ODcxOCwicHdkX2F1dGhfdGltZSI6MTc3ODI4ODcxNzgxNywic2NwIjpbIm9wZW5pZCIsImVtYWlsIiwicHJvZmlsZSIsIm9mZmxpbmVfYWNjZXNzIiwibW9kZWwucmVxdWVzdCIsIm1vZGVsLnJlYWQiLCJvcmdhbml6YXRpb24ucmVhZCIsIm9yZ2FuaXphdGlvbi53cml0ZSJdLCJzZXNzaW9uX2lkIjoiYXV0aHNlc3NfcVpmOWxabFAyTDZlZXU1YUg1Y0pSVkJrIiwic2wiOnRydWUsInN1YiI6ImF1dGgwfFZUeTc3a2xiZDIxSDBrS050VGU4cmVqUCJ9.Lrce8SF4XWuKURtQyDuVL4PhXoSLcRO1G4DUG25Jn2DmWL-TnzLcuM0aVQ2sr15tP_yUf-ejY4udAIa2SBReKgEYlf6s5j_q4V3Loztl7eXlT76Xw96vtwXGVT6uehA6E1HKsOFKSId0w47qtjWB40yDdFefLi92nQvwq71cP2necw1vPuHviMLwPIrMe6n92p0XdbS9LNdaaoF4tOEploWH-SIMJNEEQ20_afi2_Xek8TPHHwfKAvn2vSnkFztbNqIabgwTVcTeVPIIwsXh9z2iClHIKOJ7Wa4AOD9ucFd6BuT-DCbjHtiA866y7SbLIeAQmVyi1ZvnCA0VyKiURY9l9iFxJ1shwOZUGWKUEjef54dTJKvM2K2lhLlaAD2Sy4q04CiizC9iUWJGYT5zgA2y9jQIHOQ5-8X9ovQY6_0jLU8S69m_qwu3un_FxXX9SRvhY_pWWMUw3Mf8MjqshUtGpHZqGjjjATx4eVeoSBxOglY8uBg4tKpuVhDtSHkNotEwX353Elu5UzgAKiaehDySgceCDV5ZdHu-hoGNVowYYMDNVVQr0Ibx6esXYK_Uyi_v8POugZb_7tr12J1kDcB2QxLfdFEs4K1FSmPJEiAXzepn6KJTITycLFaahN3zYk6AU1qnNRhs95XnGEbYN_7d3Oi7CCzQoQ90Is_X1nc",
        "cache-control": "no-cache",
        "content-type": "application/json",
        "oai-client-build-number": "6473332",
        "oai-client-version": "prod-84bfe620fd5dd2d44306ba8091c5a8429e22c609",
        "oai-device-id": "581e5fa6-3c24-4243-9aaf-8bfeb05da26a",
        "oai-language": "en-US",
        "oai-session-id": "ec698c81-0936-494d-a87a-eeffc4a54360",
        "pragma": "no-cache",
        "priority": "u=1, i",
        "sec-ch-ua": "\"Google Chrome\";v=\"147\", \"Not.A/Brand\";v=\"8\", \"Chromium\";v=\"147\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-oai-is": "ois1.eyJ2IjoxLCJhbGciOiJBMjU2R0NNIiwia2lkIjoiY2hhdGdwdC13ZWItdjEifQ.Ost102dttkD96lk5.73z-A_Ygg0aKYaVT-YP7uqwjurn0L_P7DjxaxrrmDt-UBLzj72ggx_UwvkSAFEeEb8pPTnmpPl8fPSovw0LIOGe36_Nvq7mirynUbd9uQ-hYvnvq28MZCaKXhMkzgsrlOfKOBBZR6m3cAOK4pV-sdWNpluzhnckrCjgd3a3N0gpsvPrS7l0XqpFcaY0V_ZhXeL7tJxwiyIKLr6YN-S5V37y2gtog6kOYQgTcaO-yAOQA4QjlD31P8opU_hq1QaOjIT9E5J98_LrPtY5D66Si2hbDDq5GWoJB2rJfsHO5xt1iuh8pqt0BRmgzl7dFdbF5Wwmqi_yqxk1bgKJHB7w3abmOryrOLQjrZL8HXonCP11ZosNVx2CS8hqXCJJnve21BYL4j-JW6h574BcMDGdPm9bEtpuxq7PYm-JB-TzqBB0YeE-1O_KdqOzR4vgAGY9GbDtiF3gKtHsxSBIsQ3-peq6whYbl0nFB7FmOMgf33po2vU6_Mp84KYI6UeMSRmmJkw4jYjc7vs4kM5jln5yiHCYmYtruo6mTVUd60cV8FW87ZJJn0T62zJ9ZwxVA0E1Pytq7RHFwAi2TUwH9pzTfYJrLWVsMumMkR9WgpIN05einzMlT31d_2cI5XAvoW1Huqvjg7Nm02MxyP7pvJRGhil6TR49PlrpIDuAkl2Qupg1DobTx5Rfe8ZSJ9Bb0A479u6VNv2xzghOT3jA9issv4141N_KLzFcyYe6TWVdt7DNTwzgLwr-mHqvjxUy8t1dEpQDdj1Ezyx25AHCfMXilDn1z8NW9mYngjyCJAkfCj8-iiBZFmfmgVxnnIxh5-ZceKBzqY_PsXr7NXyou5-KWyaQSogTYKcKxc4P388ik7BAbZmZsdg93FFc7QG0WgUfTBY7jEqDpMasAxRiopa2l0lID6utmaDENQjKqbPWjuK7QPyoA0eR9yRSDZ3mA8ZvmPM6LJSx5U_-vxsEmoM56vziI1dVmiXiC2kBzQXB1geTM9E2WKrUfFzPboTGhfbEa7v5HbKCvFcTfwJpE0CKiZPURJXh9gjIEoi1xMDRL6TQRB1esq_1OcbRiv1MnDtrEZ3PGepbm1p6EuGsKxFJPamdV2eMGOFTTPM-9dMrAPYXLxoecBnSGeA",
        "x-openai-target-path": "/backend-api/accounts/mfa/enroll",
        "x-openai-target-route": "/backend-api/accounts/mfa/enroll"
    },
    "referrer": "https://chatgpt.com/",
    "body": "{\"factor_type\":\"totp\"}",
    "method": "POST",
    "mode": "cors",
    "credentials": "include"
});

/*

*/